# Interface: ViewPortCameraAnimationOptions

## Hierarchy

- **ViewPortCameraAnimationOptions**

  ↳ [ViewPortCameraAnimation](viewportcameraanimation.md)

## Properties

### durationMilliseconds

• **durationMilliseconds**: _number_

---

### `Optional` preventInterruption

• **preventInterruption**? : _undefined | false | true_

Note that if the container size changes or `setBounds` is called, it will
still interrupt the animation. But instead of cancelling it, it will jump
to the end.