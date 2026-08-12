/**
 * Element factories — the Spike C v2 creation defaults (accepted contract #3:
 * click-creates-a-default-element). Slice B's creation tools consume these;
 * until then they exist so the full v1 schema is constructible and testable.
 */
import type {
  EllipseElement,
  ImageElement,
  LineElement,
  RectElement,
  TextElement,
} from './document';

interface Point {
  x: number;
  y: number;
}

function elementBase(at: Point) {
  return {
    id: crypto.randomUUID(),
    x: at.x,
    y: at.y,
    opacity: 1,
    locked: false,
  };
}

export function newRectElement(at: Point): RectElement {
  return {
    ...elementBase(at),
    type: 'rect',
    width: 50,
    height: 36,
    fill: '#3b3b3b',
    stroke: null,
    strokeWidth: 0,
    cornerRadius: 0,
  };
}

export function newEllipseElement(at: Point): EllipseElement {
  return {
    ...elementBase(at),
    type: 'ellipse',
    width: 50,
    height: 50,
    fill: '#3b3b3b',
    stroke: null,
    strokeWidth: 0,
  };
}

export function newImageElement(at: Point): ImageElement {
  return {
    ...elementBase(at),
    type: 'image',
    width: 70,
    height: 46,
    assetId: null,
    fit: 'fill',
    cropZoom: 1,
    focal: { x: 0.5, y: 0.5 },
    fill: '#d8d3c8',
  };
}

export function newTextElement(at: Point): TextElement {
  return {
    ...elementBase(at),
    type: 'text',
    width: 70,
    text: 'Text',
    fontSize: 12,
    lineHeight: 1.4,
    fill: '#1a1a1a',
    font: 'body',
    align: 'left',
  };
}

export function newLineElement(at: Point): LineElement {
  return {
    ...elementBase(at),
    type: 'line',
    width: 60,
    height: 0,
    stroke: '#1a1a1a',
    strokeWidth: 1,
  };
}
