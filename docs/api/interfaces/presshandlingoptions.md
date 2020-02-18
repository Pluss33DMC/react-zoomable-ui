# Interface: PressHandlingOptions

## Hierarchy

- **PressHandlingOptions**

## Properties

### `Optional` capturePressThresholdMs

• **capturePressThresholdMs**? : _undefined | number_

This is more of an advanced option. If set, this will be the number of
milliseconds until the press gesture is captured. Once it is captured, it
won't be interpreted as a tap, long tap, or pan, and the `onCapturePress*`
props will begin to be called.

The default is undefined (so presses won't be captured)

---

### `Optional` ignorePressEntirely

• **ignorePressEntirely**? : _undefined | false | true_

---

### `Optional` longTapThresholdMs

• **longTapThresholdMs**? : _undefined | number_

If a press is released after this threshold, it will be considered a long
tap. The default is undefined.

---

### `Optional` onCapturePressCancelled

• **onCapturePressCancelled**? : _undefined | function_

---

### `Optional` onCapturePressEnd

• **onCapturePressEnd**? : _undefined | function_

---

### `Optional` onCapturePressMove

• **onCapturePressMove**? : _undefined | function_

---

### `Optional` onCapturePressStart

• **onCapturePressStart**? : _undefined | function_

---

### `Optional` onLongTap

• **onLongTap**? : _undefined | function_

---

### `Optional` onPotentialLongTap

• **onPotentialLongTap**? : _undefined | function_

---

### `Optional` onPotentialTap

• **onPotentialTap**? : _undefined | function_

---

### `Optional` onTap

• **onTap**? : _undefined | function_

---

### `Optional` onTapAbandoned

• **onTapAbandoned**? : _undefined | function_

---

### `Optional` potentialTapBounds

• **potentialTapBounds**? : _[ClientPixelUnit](../globals.md#clientpixelunit)_

The area around the initial event in which the pointer can move before the
press is interpreted as just a pan. It will not be considered a tap or
long tap after the pointer moves outside that area, and it can't be
captured.