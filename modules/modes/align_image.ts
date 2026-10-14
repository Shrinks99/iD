import { select as d3_select } from 'd3-selection';

import {
    geoHomographyApply, geoHomographySquareToQuad, geoQuadIsValid, geoRotate,
    geoVecAdd, geoVecAngle, geoVecDot, geoVecInterp, geoVecLengthSquare, geoVecNormalize,
    geoVecScale, geoVecSubtract
} from '../geo';
import { modeBrowse } from './browse';
import { uiCmd } from '../ui/cmd';
import { utilKeybinding } from '../util/keybinding';
import { utilFastMouse } from '../util/util';
import type { Quad } from '../geo/homography';
import type { Vec2 } from '../geo/vector';


/**
 * A handle for aligning the image:
 * - `body`, `center`: move the image
 * - `corner` 0–3 (top-left, top-right, bottom-right, bottom-left): move one corner (perspective warp)
 * - `edge` 0–3 (top, right, bottom, left): stretch the image towards or away from the opposite edge
 * - `rotate`: rotate the image around its center
 */
export interface AlignImageHandle {
    type: 'body' | 'center' | 'corner' | 'edge' | 'rotate';
    index?: number;
}

// quads smaller than this (in px²) are too small to grab
const MIN_AREA = 100;
const ROTATE_SNAP = Math.PI / 12;   // 15°


export function modeAlignImage(context: iD.Context) {
    const overlay = context.background().imageOverlay();
    const keybinding = utilKeybinding('alignImage');
    let _active = false;
    let _snapshot: Quad | null = null;
    let _drag: {
        pointerId: number;
        handle: AlignImageHandle;
        startCorners: Quad;   // lon/lat, so that zooming during a drag doesn't break it
        startPointer: Vec2;   // lon/lat
    } | null = null;

    const mode = {
        id: 'align-image',
        button: 'browse',
        enter,
        exit,
        cancel,
        startDrag,
        active: () => _active,
        selectedIDs: () => []
    };


    function project(quad: Quad): Quad {
        return quad.map(loc => context.projection(loc)) as Quad;
    }


    // The center of the image, with perspective applied
    function center(quad: Quad): Vec2 {
        return geoHomographyApply(geoHomographySquareToQuad(quad), [0.5, 0.5]);
    }


    /** Applies a quad in screen coordinates, if it is valid */
    function apply(quad: Quad) {
        if (!geoQuadIsValid(quad, MIN_AREA)) return false;
        overlay
            .corners(quad.map(p => context.projection.invert(p)) as Quad)
            .redrawNow();
        return true;
    }


    function transformBy(fn: (quad: Quad) => Quad) {
        return (d3_event: KeyboardEvent) => {
            d3_event.preventDefault();
            const quad = overlay.screenCorners();
            if (quad) apply(fn(quad));
        };
    }


    function nudge(delta: Vec2) {
        return transformBy(quad => quad.map(p => geoVecAdd(p, delta)) as Quad);
    }


    function scale(factor: number) {
        return transformBy(quad => {
            const c = center(quad);
            return quad.map(p => geoVecAdd(c, geoVecScale(geoVecSubtract(p, c), factor))) as Quad;
        });
    }


    function rotate(angle: number) {
        return transformBy(quad => geoRotate(quad, angle, center(quad)) as Quad);
    }


    function dragged(handle: AlignImageHandle, start: Quad, delta: Vec2, startPointer: Vec2, pointer: Vec2, shiftKey: boolean): Quad {
        const i = handle.index || 0;

        switch (handle.type) {
            case 'corner': {
                const moved = geoVecAdd(start[i], delta);
                if (!shiftKey) {
                    const quad = [...start] as Quad;
                    quad[i] = moved;
                    return quad;
                }
                // scale uniformly around the opposite corner
                const origin = start[(i + 2) % 4];
                const diagonal = geoVecSubtract(start[i], origin);
                const factor = geoVecDot(geoVecSubtract(moved, origin), diagonal) / geoVecLengthSquare(diagonal);
                return start.map(p => geoVecAdd(origin, geoVecScale(geoVecSubtract(p, origin), factor))) as Quad;
            }

            case 'edge': {
                // move both corners of the edge along the axis to the opposite edge
                const a = i;
                const b = (i + 1) % 4;
                const mid = geoVecInterp(start[a], start[b], 0.5);
                const opposite = geoVecInterp(start[(i + 2) % 4], start[(i + 3) % 4], 0.5);
                const axis = geoVecNormalize(geoVecSubtract(mid, opposite));
                const shift = geoVecScale(axis, geoVecDot(delta, axis));
                const quad = [...start] as Quad;
                quad[a] = geoVecAdd(start[a], shift);
                quad[b] = geoVecAdd(start[b], shift);
                return quad;
            }

            case 'rotate': {
                const c = center(start);
                let angle = geoVecAngle(c, pointer) - geoVecAngle(c, startPointer);
                if (shiftKey) angle = Math.round(angle / ROTATE_SNAP) * ROTATE_SNAP;
                return geoRotate(start, angle, c) as Quad;
            }

            default:   // body, center
                return start.map(p => geoVecAdd(p, delta)) as Quad;
        }
    }


    function pointerMove(d3_event: PointerEvent) {
        if (!_drag || d3_event.pointerId !== _drag.pointerId) return;
        d3_event.preventDefault();
        d3_event.stopPropagation();

        // the button was released while the pointerup event couldn't reach us
        if (!d3_event.buttons) {
            endDrag();
            return;
        }

        const mapNode = context.container().select('.main-map').node() as HTMLElement;
        const pointer = utilFastMouse(mapNode)(d3_event) as Vec2;
        const start = project(_drag.startCorners);
        const startPointer = context.projection(_drag.startPointer);
        const delta = geoVecSubtract(pointer, startPointer);

        apply(dragged(_drag.handle, start, delta, startPointer, pointer, d3_event.shiftKey));
    }


    function pointerUp(d3_event: PointerEvent) {
        if (!_drag || d3_event.pointerId !== _drag.pointerId) return;
        endDrag();
    }


    function endDrag() {
        _drag = null;
        d3_select(window)
            .on('pointermove.alignImage pointerup.alignImage pointercancel.alignImage blur.alignImage', null);
        context.container().classed('align-image-dragging', false);
    }


    /** Called by the handles drawn on the map, see `svgImageOverlayHandles` */
    function startDrag(d3_event: PointerEvent, handle: AlignImageHandle) {
        if (!_active || _drag) return;
        if (d3_event.pointerType === 'mouse' && d3_event.button !== 0) return;
        // don't let the map pan
        d3_event.preventDefault();
        d3_event.stopPropagation();

        const mapNode = context.container().select('.main-map').node() as HTMLElement;
        const corners = overlay.corners();
        if (!corners) return;

        _drag = {
            pointerId: d3_event.pointerId,
            handle,
            startCorners: corners,
            startPointer: context.projection.invert(utilFastMouse(mapNode)(d3_event))
        };

        d3_select(window)
            .on('pointermove.alignImage', pointerMove, true)
            .on('pointerup.alignImage pointercancel.alignImage', pointerUp, true)
            // e.g. switching to another window during the drag
            .on('blur.alignImage', endDrag);
        context.container().classed('align-image-dragging', true);
    }


    function browse() {
        context.enter(modeBrowse(context) as any);
    }


    function finish(d3_event?: KeyboardEvent) {
        d3_event?.preventDefault();
        browse();
    }


    /** Reverts to the alignment from before entering the mode */
    function cancel(d3_event?: KeyboardEvent) {
        d3_event?.preventDefault();
        if (_snapshot) overlay.corners(_snapshot);
        browse();
    }


    function enter() {
        _active = true;
        _snapshot = overlay.corners();

        // capture escape, so that it also works while an input in the sidebar has focus
        keybinding
            .on('⎋', cancel, true)
            .on('↩', finish, false)
            .on(uiCmd('⇧←'), nudge([-10, 0]), false)
            .on(uiCmd('⇧↑'), nudge([0, -10]), false)
            .on(uiCmd('⇧→'), nudge([10, 0]), false)
            .on(uiCmd('⇧↓'), nudge([0, 10]), false)
            .on(uiCmd('⇧⌥←'), nudge([-100, 0]), false)
            .on(uiCmd('⇧⌥↑'), nudge([0, -100]), false)
            .on(uiCmd('⇧⌥→'), nudge([100, 0]), false)
            .on(uiCmd('⇧⌥↓'), nudge([0, 100]), false)
            .on(utilKeybinding.plusKeys.map(key => uiCmd('⇧' + key)), scale(1.05), false)
            .on(utilKeybinding.minusKeys.map(key => uiCmd('⇧' + key)), scale(1 / 1.05), false)
            .on('[', rotate(-Math.PI / 180), false)
            .on(']', rotate(Math.PI / 180), false)
            .on('{', rotate(-ROTATE_SNAP), false)
            .on('}', rotate(ROTATE_SNAP), false);

        d3_select(document)
            .call(keybinding);

        overlay.redrawNow();   // draws the handles
    }


    // Leaving the mode in any way other than `cancel` keeps the new alignment
    function exit() {
        _active = false;
        endDrag();

        d3_select(document)
            .call(keybinding.unbind);

        overlay.changed();   // redraws the map, which removes the handles
    }


    return mode;
}
