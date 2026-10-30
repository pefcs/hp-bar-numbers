/*
 * HP Bar Numbers v0.5.0
 * Foundry VTT v14 + D&D 5e 6.x
 *
 * Guarded test build: preserves the native renderer and treats label rendering
 * as optional. It never writes actor/token data or changes native bar settings.
 */
const MODULE_ID = "hp-bar-numbers";
const LABEL_KEY = `${MODULE_ID}-label`;
let patched = false;

function logError(message, error) {
  console.error(`${MODULE_ID} | ${message}`, error ?? "");
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function removeExistingLabel(bar) {
  try {
    const existing = bar?.children?.find(child => child?.name === LABEL_KEY);
    if (!existing) return;
    bar.removeChild(existing);
    existing.destroy?.({ children: true });
  } catch (error) {
    // Label cleanup must never interrupt Foundry's native HP-bar draw.
    logError("Could not remove the previous label; continuing safely.", error);
  }
}

function addHPLabel(token, bar) {
  try {
    if (!bar || typeof bar.addChild !== "function") return;

    const hp = token.document?.actor?.system?.attributes?.hp;
    if (!hp || hp.value == null || hp.max == null) return;

    const PIXIRef = globalThis.PIXI;
    // Match Bar Brawl's general rendering approach: use PIXI.Text with a clone
    // of Foundry's canvas text style, then explicitly set bar-label properties.
    const TextClass = PIXIRef?.Text;
    if (typeof TextClass !== "function") return;

    const scale = Number(canvas?.dimensions?.uiScale) || 1;
    const width = Number(token.w);
    const height = 8 * (Number(token.document?.height) >= 2 ? 1.5 : 1) * scale;
    if (!(width > 0 && height > 0)) return;

    const labelText = `${formatNumber(hp.value)} / ${formatNumber(hp.max)}`;
    const baseFontSize = Math.max(10, Math.min(15, height * 1));

    let style;
    try {
      const canvasStyle = globalThis.CONFIG?.canvasTextStyle;
      style = canvasStyle?.clone
        ? canvasStyle.clone()
        : new PIXIRef.TextStyle(canvasStyle ? { ...canvasStyle } : {});
    } catch (_) {
      style = new PIXIRef.TextStyle();
    }

    // Override only the properties relevant to the HP label. Keep the familiar
    // white fill and dark outline while inheriting Foundry's baseline text style.
    Object.assign(style, {
      fontFamily: "Arial, sans-serif",
      fontSize: baseFontSize,
      fontWeight: "600",
      fill: "#ffffff",
      align: "center",
      stroke: "#000000",
      strokeThickness: Math.max(0.5, Math.min(4, height * 0.1)),
      dropShadow: true
    });

    // Fit against the final PIXI.Text measurement, after applying the complete
    // style. Recreate the text after each size adjustment so width is measured
    // from the updated texture/style, not a stale cached measurement.
    const horizontalPadding = Math.max(4, height * 0.3);
    const availableWidth = Math.max(1, width - horizontalPadding * 2);
    let label = new TextClass(labelText, style);
    label.resolution = 3;

    // Account for the outline and leave a small safety margin. Re-measure each
    // pass because PIXI text metrics can change non-linearly with font size.
    for (let attempt = 0; attempt < 5 && label.width > availableWidth; attempt++) {
      const currentSize = Number(style.fontSize) || baseFontSize;
      const ratio = availableWidth / Math.max(1, label.width);
      const nextSize = Math.max(8, currentSize * Math.min(0.97, ratio * 0.96));
      if (nextSize >= currentSize || currentSize <= 8) break;
      label.destroy?.();
      style.fontSize = nextSize;
      label = new TextClass(labelText, style);
      label.resolution = 3;
    }
    label.name = LABEL_KEY;
    if (label.anchor?.set) label.anchor.set(0.5, 0.5);
    label.x = width / 2;
    label.y = height / 2;
    label.eventMode = "none";
    label.zIndex = 1000;
    bar.addChild(label);
  } catch (error) {
    // Deliberately swallow label-only failures; native HP rendering must survive.
    logError("Could not draw the HP label; native HP bar is left intact.", error);
  }
}

Hooks.once("ready", () => {
  try {
    if (patched) return;

    // Foundry v14 exposes the generic Token#_drawBar method instead of the
    // older D&D 5e-specific _drawHPBar method. Prefer the legacy method when
    // present, otherwise adapt to the v14 generic bar renderer.
    const configuredTokenClass = globalThis.CONFIG?.Token?.objectClass;
    const liveToken = canvas.tokens?.placeables?.find(token =>
      typeof token?._drawHPBar === "function" || typeof token?._drawBar === "function"
    );
    const TokenClass = (
      configuredTokenClass && (
        typeof configuredTokenClass.prototype?._drawHPBar === "function" ||
        typeof configuredTokenClass.prototype?._drawBar === "function"
      )
        ? configuredTokenClass
        : liveToken?.constructor
    );
    const prototype = TokenClass?.prototype;
    const methodName = typeof prototype?._drawHPBar === "function"
      ? "_drawHPBar"
      : typeof prototype?._drawBar === "function"
        ? "_drawBar"
        : null;

    if (!prototype || !methodName) {
      logError("Could not find _drawHPBar or _drawBar on CONFIG.Token.objectClass or a live token class.");
      return;
    }

    const originalDrawBar = prototype[methodName];
    prototype[methodName] = function(index, bar, data) {
      // In v14 _drawBar is generic, so only add the label to the configured HP
      // bar. Older _drawHPBar is already HP-specific.
      let isHPBar = methodName === "_drawHPBar";
      if (!isHPBar) {
        const configuredBar = this.document?.[`bar${Number(index) + 1}`];
        const attribute = data?.attribute ?? configuredBar?.attribute;
        const normalizedAttribute = String(attribute ?? "").replace(/^system\./, "");
        isHPBar = normalizedAttribute === "attributes.hp";
      }

      if (!isHPBar) return originalDrawBar.call(this, index, bar, data);

      try {
        removeExistingLabel(bar);
        // Restore our previous visual transform before Foundry redraws the bar,
        // avoiding cumulative scale/position changes on repeated refreshes.
        if (bar?.scale && Number.isFinite(bar.__hpBarNumbersBaseScaleY)) {
          bar.scale.y = bar.__hpBarNumbersBaseScaleY;
        }
        if (bar?.position && Number.isFinite(bar.__hpBarNumbersBaseY)) {
          bar.position.y = bar.__hpBarNumbersBaseY;
        }
      } catch (error) {
        logError("Could not reset the previous HP-bar label transform; continuing safely.", error);
      }

      const result = originalDrawBar.call(this, index, bar, data);

      // Experimental visual-only adjustment: make the rendered HP bar 35% taller
      // while preserving its vertical center. This does not change token data.
      try {
        if (bar?.scale && bar.position) {
          const scaleY = 1.35;
          const originalHeight = 8 * (Number(this.document?.height) >= 2 ? 1.5 : 1) * (Number(canvas?.dimensions?.uiScale) || 1);
          const baseScaleY = Number.isFinite(bar.__hpBarNumbersBaseScaleY)
            ? bar.__hpBarNumbersBaseScaleY
            : (bar.__hpBarNumbersBaseScaleY = Number(bar.scale.y) || 1);
          const baseY = Number.isFinite(bar.__hpBarNumbersBaseY)
            ? bar.__hpBarNumbersBaseY
            : (bar.__hpBarNumbersBaseY = Number(bar.position.y) || 0);
          bar.scale.y = baseScaleY * scaleY;
          bar.position.y = baseY - originalHeight * (scaleY - 1) / 2;
        }
      } catch (error) {
        logError("Could not apply the experimental bar-height adjustment; continuing with native height.", error);
      }

      addHPLabel(this, bar);
      // Counteract the parent's vertical scale on the label so only the bar
      // itself grows; the text retains its chosen size and remains centered.
      try {
        const label = bar?.children?.find(child => child?.name === LABEL_KEY);
        if (label?.scale) label.scale.y = 1 / 1.35;
      } catch (_) { /* Label styling must never disrupt native rendering. */ }
      return result;
    };

    patched = true;
    console.log(`${MODULE_ID} | v0.5.0 ready. Guarded hook installed on ${TokenClass.name}.prototype.${methodName}.`);
  } catch (error) {
    // Installation errors should be visible, but must not propagate into canvas setup.
    logError("Hook installation failed; native HP bars will remain unmodified.", error);
  }
});
