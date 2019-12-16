// tslint:disable-next-line: no-implicit-dependencies - Disable this until we get our changes merged into pan-zoom
import panzoom, { PanZoomControl } from 'pan-zoom';
import * as React from 'react';

import { Context, ContextType } from './Context';
import { Interactable } from './Interactable';
import { generateRandomId, walkElementHierarchyUp } from './utils';
import { ViewPort } from './ViewPort';

export interface ProviderProps {
  readonly pollForElementResizing?: boolean;
  readonly zoomFactorMax?: number;
  readonly zoomFactorMin?: number;
}

export class Provider extends React.PureComponent<ProviderProps> {
  private contextValue: ContextType;
  private containerDivRef?: HTMLElement;
  private handlePollForElementResizing?: any;
  private interactableRegistry: Map<string, Interactable>;
  private isCurrentPanGestureBlocked?: boolean;
  private panZoomControl?: PanZoomControl;
  private viewPort: ViewPort;

  private readonly rootDivUniqueClassName = `react-zoomable-ui-${generateRandomId()}`;
  private readonly constantStyles = `
div.${this.rootDivUniqueClassName} {
  overflow: hidden;
  margin: 0; padding: 0; height: 100%; width: 100%;
  position: relative;
  ${/* Prevent the user from highlighting while dragging */ ''}
  -webkit-user-select: none;
  user-select: none;
  ${/* Prevent the user from getting a text input box cursor when hovering over text that can be dragged */ ''}
  cursor: default;
}

${
  /*
  This is the only way AFAIK to suppress image dragging events on stuff
  inside the zoomable area without forcing users of the library to do it
  themselves (or add something like `draggable=false` to their `<img>`s)*/ ''
}
div.${this.rootDivUniqueClassName} img {
  -webkit-user-drag: none;
  -moz-user-drag: none;
  -ms-user-drag: none;
  user-drag: none;
}

div.${this.rootDivUniqueClassName} div.${Interactable.IgnoreGesturesClassName} {
  -webkit-user-select: text;
  user-select: text;
  cursor: auto;
}
`;

  public constructor(props: ProviderProps) {
    super(props);
    this.viewPort = new ViewPort(this.props.zoomFactorMin, this.props.zoomFactorMax);

    this.interactableRegistry = new Map();

    this.contextValue = {
      registerInteractable: i => this.interactableRegistry.set(i.id, i),
      rootDivUniqueClassName: this.rootDivUniqueClassName,
      unregisterInteractable: i => this.interactableRegistry.delete(i.id),
      viewPort: this.viewPort,
    };

    // This is optional because it is unnecessary if the only way the div's size
    // will change is with the window itself
    if (this.props.pollForElementResizing) {
      this.startPollingForElementResizing();
    }
  }

  public componentDidUpdate(prevProps: ProviderProps) {
    if (this.props.pollForElementResizing !== prevProps.pollForElementResizing) {
      if (this.props.pollForElementResizing) {
        this.startPollingForElementResizing();
      } else {
        this.stopPollingForElementResizing();
      }
    }
  }

  public componentWillUnmount() {
    this.removeEventHandlers();
    this.stopPollingForElementResizing();
  }

  public render() {
    return (
      <div
        ref={this.setContainerDivRef}
        className={`react-zoomable-ui ${this.rootDivUniqueClassName} react-zoomable-ui-container-div`}
      >
        <style>{this.constantStyles}</style>
        <Context.Provider value={this.contextValue}>{this.props.children}</Context.Provider>
      </div>
    );
  }

  public updateContainerSize = () => {
    if (this.containerDivRef) {
      const { width, height } = this.containerDivRef.getBoundingClientRect();
      if (width !== this.viewPort.containerWidth || height !== this.viewPort.containerHeight) {
        this.viewPort.updateContainerDimensions(width, height);
      }
    }
  };

  private addEventHandlers() {
    if (this.containerDivRef) {
      this.containerDivRef.addEventListener('mousedown', this.handleMouseDown);
      this.containerDivRef.addEventListener('mousemove', this.handleMouseMove);

      // Doing this on window to catch it if it goes outside the window
      window.addEventListener('mouseup', this.handleMouseUp);

      // There is no good way to detect whether an individual element is
      // resized. We can only do that at the window level. There are some
      // techniques for tracking element sizes, and we provide an OPTIONAL
      // polling based technique. But since watching for window resizes WILL
      // work for many use cases we do that here, and it shouldn't interfere
      // with any more specific techniques.
      window.addEventListener('resize', this.updateContainerSize);
    }
  }

  private getInteractableIdMostApplicableToElement = (element: HTMLElement): string | undefined => {
    for (const e of walkElementHierarchyUp(element)) {
      if (e.classList.contains(this.rootDivUniqueClassName)) {
        return undefined;
      }
      const a = e.getAttribute(Interactable.IdAttributeName);
      if (a) {
        return a;
      }
    }
    return undefined;
  };

  private handleMouseDown = (e: MouseEvent) => {
    if (!e.target || !this.panZoomControl) {
      return;
    }

    const elementTagName = e.target && (e.target as any).tagName;
    if (elementTagName === 'a' || elementTagName === 'A') {
      // Prevent dragging on <a> tags since A. the browsers may interpret the
      // drag end as a click on it and B. desktop Safari (possibly others) has
      // its own drag handling for links which conflicts with what we are doing.
      //
      // For my own future reference: the mouse down event gets fired before the
      // impetus library used by pan-zoom fires any events for the pan.
      this.panZoomControl!.blockPan();
    }

    const interactableId = this.getInteractableIdMostApplicableToElement(e.target as any);
    const interactable = (interactableId && this.interactableRegistry.get(interactableId)) || undefined;

    if (interactable && interactable.props.ignoreGestures) {
      this.panZoomControl.blockPan();
      this.isCurrentPanGestureBlocked = true;
    }
  };

  private handleMouseMove = (e: MouseEvent) => {
    if (this.isCurrentPanGestureBlocked) {
      // Don't let impetus handle this mouse event because it will
      // preventDefault() it which will prevent the user from selecting text.
      e.stopImmediatePropagation();
    }
  };

  private handleMouseUp = (e: MouseEvent) => {
    this.isCurrentPanGestureBlocked = false;
    // if (this.panZoomControl) {
    //   this.panZoomControl.unblockPan();
    // }
    // if (this.currentInteractionHandler) {
    //   this.currentInteractionHandler.onPointerUp(e);
    //   this.currentInteractionHandler.clearTimeouts();
    //   this.currentInteractionHandler = undefined;
    // }
  };

  private removeEventHandlers = () => {
    if (this.containerDivRef && this.panZoomControl) {
      this.panZoomControl.destroy();

      this.containerDivRef.removeEventListener('mousedown', this.handleMouseDown);
      this.containerDivRef.removeEventListener('mousemove', this.handleMouseMove);

      window.removeEventListener('resize', this.updateContainerSize);
    }
  };

  private startPollingForElementResizing = () => {
    if (this.handlePollForElementResizing) {
      this.stopPollingForElementResizing();
    }
    this.handlePollForElementResizing = setInterval(() => {
      if (this.containerDivRef) {
        const { width, height } = this.containerDivRef.getBoundingClientRect();
        if (width !== this.viewPort.containerWidth || height !== this.viewPort.containerHeight) {
          this.viewPort.updateContainerDimensions(width, height);
        }
      }
    }, 500);
  };

  private stopPollingForElementResizing = () => {
    if (this.handlePollForElementResizing) {
      clearInterval(this.handlePollForElementResizing);
    }
    this.handlePollForElementResizing = undefined;
  };

  private setContainerDivRef = (ref: any) => {
    this.removeEventHandlers();
    this.containerDivRef = ref;
    if (this.containerDivRef) {
      this.viewPort.update(0, 0, 1);
      this.panZoomControl = panzoom(this.containerDivRef, this.viewPort.processPanZoomEvent);
      this.addEventHandlers();
      // Make sure we set the screen dimensions on the element
      this.updateContainerSize();
    }
  };
}
