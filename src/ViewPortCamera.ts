import { ClientPixelUnit, ViewPortBounds, VirtualSpacePixelUnit, ZoomFactor } from './ViewPort';

export interface ViewPortCameraValues {
  // tslint:disable: readonly-keyword
  containerWidth: ClientPixelUnit;
  containerHeight: ClientPixelUnit;
  centerX: VirtualSpacePixelUnit;
  centerY: VirtualSpacePixelUnit;
  left: VirtualSpacePixelUnit;
  top: VirtualSpacePixelUnit;
  width: VirtualSpacePixelUnit;
  height: VirtualSpacePixelUnit;
  zoomFactor: ZoomFactor; // E.g. 2 is zoomed in, 1 is exactly at pixel perfect match to images, and 0.5 is zoomed out.
  // tslint:enable: readonly-keyword
}

export class ViewPortCamera {
  private actualDerivedZBounds?: readonly [number | undefined, number | undefined];
  private bounds?: ViewPortBounds;

  private animationFrameId?: number;
  private animatingVelocityX: VirtualSpacePixelUnit;
  private animatingVelocityY: VirtualSpacePixelUnit;
  private isAnimating: boolean;

  private workingValues: ViewPortCameraValues;

  constructor(private readonly values: ViewPortCameraValues, private readonly onUpdated?: () => void) {
    this.animatingVelocityX = 0;
    this.animatingVelocityY = 0;
    this.isAnimating = false;
    this.workingValues = { ...values };

    // Semi-sane default bounds...
    this.bounds = { z: [0.001, 100] };
  }

  public centerFitAreaIntoView(
    left: VirtualSpacePixelUnit,
    top: VirtualSpacePixelUnit,
    width: VirtualSpacePixelUnit,
    height: VirtualSpacePixelUnit,
    additionalBounds?: Pick<ViewPortBounds, 'z'>,
  ): void {
    const cx = left + width / 2;
    const cy = top + height / 2;
    const zoomFactorBasedOnWidth = this.workingValues.containerWidth / width;
    const zoomFactorBasedOnHeight = this.workingValues.containerHeight / height;
    let newZoomFactor = Math.min(zoomFactorBasedOnWidth, zoomFactorBasedOnHeight);
    newZoomFactor = clampNormally(newZoomFactor, additionalBounds?.z);
    this.recenter(cx, cy, newZoomFactor);
  }

  public centerFitHorizontalAreaIntoView(
    left: VirtualSpacePixelUnit,
    width: VirtualSpacePixelUnit,
    additionalBounds?: Pick<ViewPortBounds, 'z'>,
  ): void {
    const centerX = left + width / 2;
    let newZoomFactor = this.workingValues.containerWidth / width;
    newZoomFactor = clampNormally(newZoomFactor, additionalBounds?.z);
    this.updateTopLeft(centerX - this.workingValues.width / newZoomFactor / 2, this.workingValues.top, newZoomFactor);
  }

  public destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }
  }

  public moveByInClientSpace(
    dx: ClientPixelUnit,
    dy: ClientPixelUnit,
    dz: ClientPixelUnit,
    pointerContainerX: ClientPixelUnit,
    pointerContainerY: ClientPixelUnit,
    eventType?: 'mouse' | 'touch' | 'wheel',
  ) {
    let zoomFactor = this.workingValues.zoomFactor;
    if (dz !== 0) {
      // tslint:disable-next-line: prefer-conditional-expression
      if (eventType === 'wheel') {
        // In the wheel case this makes the zoom feel more like its going at a
        // linear speed.
        zoomFactor =
          (this.workingValues.containerHeight * this.workingValues.zoomFactor) /
          (this.workingValues.containerHeight + dz * 2);
      } else {
        // It feels too fast if we don't divide by two... some hammer.js issue?
        zoomFactor = zoomFactor + dz / 2;
      }
      zoomFactor = clampNormally(zoomFactor, this.actualDerivedZBounds);
    }

    // Basic pan handling
    const virtualSpaceNewLeft = this.workingValues.left + (-1 * dx) / zoomFactor;
    const virtualSpaceNewTop = this.workingValues.top + (-1 * dy) / zoomFactor;

    // Zoom BUT keep the view coordinate under the mouse pointer CONSTANT
    const oldVirtualSpaceVisibleSpaceWidth = this.workingValues.containerWidth / this.workingValues.zoomFactor;
    const oldVirtualSpaceVisibleSpaceHeight = this.workingValues.containerHeight / this.workingValues.zoomFactor;
    this.workingValues.width = this.workingValues.containerWidth / zoomFactor;
    this.workingValues.height = this.workingValues.containerHeight / zoomFactor;
    this.workingValues.zoomFactor = zoomFactor;

    const virtualSpaceVisibleWidthDelta = this.workingValues.width - oldVirtualSpaceVisibleSpaceWidth;
    const virtualSpaceVisibleHeightDelta = this.workingValues.height - oldVirtualSpaceVisibleSpaceHeight;

    // The reason we use x and y here is to zoom in or out towards where the
    // pointer is positioned
    const xFocusPercent = pointerContainerX / this.workingValues.containerWidth;
    const yFocusPercent = pointerContainerY / this.workingValues.containerHeight;

    this.workingValues.centerX = clampWithSpace(
      virtualSpaceNewLeft - virtualSpaceVisibleWidthDelta * xFocusPercent + this.workingValues.width / 2,
      this.workingValues.width,
      this.bounds?.x,
    );
    this.workingValues.centerY = clampWithSpace(
      virtualSpaceNewTop - virtualSpaceVisibleHeightDelta * yFocusPercent + this.workingValues.height / 2,
      this.workingValues.height,
      this.bounds?.y,
    );
    this.workingValues.left = this.workingValues.centerX - this.workingValues.width / 2;
    this.workingValues.top = this.workingValues.centerY - this.workingValues.height / 2;

    this.scheduleHardUpdate();
  }

  public moveByDecelerationInClientSpace = (vx: ClientPixelUnit, vy: ClientPixelUnit) => {
    const VELOCITY_BOOST = 20;
    this.animatingVelocityX += (vx * VELOCITY_BOOST) / this.workingValues.zoomFactor;
    this.animatingVelocityY += (vy * VELOCITY_BOOST) / this.workingValues.zoomFactor;
    this.scheduleAnimation();
  };

  /**
   * This is not intended to be called by code outside of react-zoomable-ui itself.
   */
  public handleContainerSizeChanged(width: ClientPixelUnit, height: ClientPixelUnit) {
    if (width === this.workingValues.containerWidth && height === this.workingValues.containerHeight) {
      return;
    }

    // This is intended to handle the case where we first get our container dimensions
    const wasZeroWidthHeightCenter =
      this.workingValues.width === 0 &&
      this.workingValues.height === 0 &&
      this.workingValues.centerX === 0 &&
      this.workingValues.centerY === 0;

    this.workingValues.containerWidth = width;
    this.workingValues.containerHeight = height;
    this.workingValues.width = this.workingValues.containerWidth / this.workingValues.zoomFactor;
    this.workingValues.height = this.workingValues.containerHeight / this.workingValues.zoomFactor;

    if (wasZeroWidthHeightCenter) {
      this.workingValues.centerX = this.workingValues.width / 2;
      this.workingValues.centerY = this.workingValues.height / 2;
    }

    // Since the new size may decrease or change the actual derived z bounds...
    this.dealWithBoundsChange();
  }

  public recenter(x: VirtualSpacePixelUnit, y: VirtualSpacePixelUnit, newZoomFactor?: ZoomFactor): void {
    if (newZoomFactor !== undefined) {
      this.workingValues.zoomFactor = clampNormally(newZoomFactor, this.actualDerivedZBounds);
      this.workingValues.width = this.workingValues.containerWidth / this.workingValues.zoomFactor;
      this.workingValues.height = this.workingValues.containerHeight / this.workingValues.zoomFactor;
    }

    this.workingValues.centerX = clampWithSpace(x, this.workingValues.width, this.bounds?.x);
    this.workingValues.centerY = clampWithSpace(y, this.workingValues.height, this.bounds?.y);
    this.workingValues.left = this.workingValues.centerX - this.workingValues.width / 2;
    this.workingValues.top = this.workingValues.centerY - this.workingValues.height / 2;

    this.scheduleHardUpdate();
  }
  /**
   * This is not intended to be called by code outside of react-zoomable-ui itself.
   */
  public setBounds(bounds?: ViewPortBounds) {
    this.bounds = bounds;
    this.dealWithBoundsChange();
  }

  public setBoundsToContent() {
    this.bounds = {
      x: [0, this.workingValues.containerWidth],
      y: [0, this.workingValues.containerHeight],
      // Can't zoom out but you can zoom in
      z: [1, undefined],
    };
    this.dealWithBoundsChange();
  }

  public updateTopLeft(x: VirtualSpacePixelUnit, y: VirtualSpacePixelUnit, zoomFactor?: ZoomFactor): void {
    // This looks deceptively like recenter, but if the zoomFactor is changing
    // the width and height area gets changed and so it can result in a
    // different result
    if (zoomFactor !== undefined) {
      this.workingValues.zoomFactor = clampNormally(zoomFactor, this.bounds?.z);
      this.workingValues.width = this.workingValues.containerWidth / this.workingValues.zoomFactor;
      this.workingValues.height = this.workingValues.containerHeight / this.workingValues.zoomFactor;
    }
    this.workingValues.centerX = x + this.workingValues.width / 2;
    this.workingValues.centerY = y + this.workingValues.height / 2;
    this.workingValues.left = x;
    this.workingValues.top = y;

    this.scheduleHardUpdate();
  }

  private handleAnimationFrame = (/*time: number*/) => {
    this.animationFrameId = undefined;
    // var progress = time - (this.priorTimestamp || time);
    // this.priorTimestamp = time;
    if (this.isAnimating) {
      const FRICTION = 0.84;
      this.animatingVelocityX *= FRICTION;
      if (Math.abs(this.animatingVelocityX) < 0.2) {
        this.animatingVelocityX = 0;
      }
      this.animatingVelocityY *= FRICTION;
      if (Math.abs(this.animatingVelocityY) < 0.2) {
        this.animatingVelocityY = 0;
      }

      if (Math.abs(this.animatingVelocityX) > 0 || Math.abs(this.animatingVelocityY) > 0) {
        if (
          this.animatingVelocityX < 0 &&
          this.bounds?.x?.[0] !== undefined &&
          this.workingValues.left - this.animatingVelocityX > this.bounds.x[0]
        ) {
          this.animatingVelocityX *= -1;
          this.workingValues.centerX = this.bounds.x[0] + this.workingValues.width / 2;
        } else if (
          this.animatingVelocityX > 0 &&
          this.bounds?.x?.[1] !== undefined &&
          this.workingValues.left + this.workingValues.width - this.animatingVelocityX > this.bounds.x[1]
        ) {
          this.animatingVelocityX *= -1;
          this.workingValues.centerX = this.bounds.x[1] - this.workingValues.width / 2;
        } else {
          this.workingValues.centerX -= this.animatingVelocityX;
        }

        if (
          this.animatingVelocityY < 0 &&
          this.bounds?.y?.[0] !== undefined &&
          this.workingValues.top - this.animatingVelocityY > this.bounds.y[0]
        ) {
          this.animatingVelocityY *= -1;
          this.workingValues.centerX = this.bounds.y[0] + this.workingValues.height / 2;
        } else if (
          this.animatingVelocityY > 0 &&
          this.bounds?.y?.[1] !== undefined &&
          this.workingValues.top + this.workingValues.height - this.animatingVelocityY > this.bounds.y[1]
        ) {
          this.animatingVelocityY *= -1;
          this.workingValues.centerX = this.bounds.y[1] - this.workingValues.height / 2;
        } else {
          this.workingValues.centerX -= this.animatingVelocityY;
        }

        this.workingValues.left = this.workingValues.centerX - this.workingValues.width / 2;
        this.workingValues.top = this.workingValues.centerY - this.workingValues.height / 2;
        // Continue animating
        this.animationFrameId = requestAnimationFrame(this.handleAnimationFrame);
      } else {
        this.animatingVelocityX = 0;
        this.animatingVelocityY = 0;
        this.isAnimating = false;
      }
    }

    this.values.centerX = this.workingValues.centerX;
    this.values.centerY = this.workingValues.centerY;
    this.values.containerHeight = this.workingValues.containerHeight;
    this.values.containerWidth = this.workingValues.containerWidth;
    this.values.height = this.workingValues.height;
    this.values.left = this.workingValues.left;
    this.values.width = this.workingValues.width;
    this.values.top = this.workingValues.top;
    this.values.zoomFactor = this.workingValues.zoomFactor;

    this.onUpdated?.();
  };

  private dealWithBoundsChange() {
    // Rederive actualDerivedZBounds first
    let min;
    let max;
    if (this.bounds?.x && this.bounds.x?.[0] !== undefined && this.bounds.x?.[1] !== undefined) {
      const space: VirtualSpacePixelUnit = this.bounds.x[1] - this.bounds.x[0];
      min = this.workingValues.containerWidth / space;
    }
    if (this.bounds?.y && this.bounds.y?.[0] !== undefined && this.bounds.y?.[1] !== undefined) {
      const space: VirtualSpacePixelUnit = this.bounds.y[1] - this.bounds.y[0];
      min = min
        ? Math.min(min, this.workingValues.containerHeight / space)
        : this.workingValues.containerHeight / space;
    }
    if (this.bounds?.z) {
      if (this.bounds.z[0] !== undefined) {
        min = min ? Math.min(min, this.bounds.z[0]) : this.bounds.z[0];
      }
      if (this.bounds.z[1] !== undefined) {
        max = this.bounds.z[1];
      }
    }
    this.actualDerivedZBounds = min === undefined && max === undefined ? undefined : [min, max];

    // Then update zoomFactor is needed
    this.workingValues.zoomFactor = clampNormally(this.workingValues.zoomFactor, this.actualDerivedZBounds);
    this.workingValues.width = this.workingValues.containerWidth / this.workingValues.zoomFactor;
    this.workingValues.height = this.workingValues.containerHeight / this.workingValues.zoomFactor;

    // And clamp down on the x and y position of the camera
    this.workingValues.centerX = clampWithSpace(this.workingValues.centerX, this.workingValues.width, this.bounds?.x);
    this.workingValues.centerY = clampWithSpace(this.workingValues.centerY, this.workingValues.height, this.bounds?.y);
    this.workingValues.left = this.workingValues.centerX - this.workingValues.width / 2;
    this.workingValues.top = this.workingValues.centerY - this.workingValues.height / 2;

    this.scheduleHardUpdate();
  }
  private scheduleAnimation() {
    this.isAnimating = true;
    if (!this.animationFrameId) {
      this.animationFrameId = requestAnimationFrame(this.handleAnimationFrame);
    }
  }

  private scheduleHardUpdate() {
    this.isAnimating = false;
    this.animatingVelocityX = 0;
    this.animatingVelocityY = 0;
    if (!this.animationFrameId) {
      this.animationFrameId = requestAnimationFrame(this.handleAnimationFrame);
    }
  }
}
