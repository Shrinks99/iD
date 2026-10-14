import { geoHomographyApply, geoVecAdd, geoVecNormalize, geoVecScale, geoVecSubtract } from '../geo';
import type { AlignImageHandle } from '../modes/align_image';
import type { Vec2 } from '../geo/vector';
import type { SvgLayer } from './layers';


type HandleDatum = AlignImageHandle & { point: Vec2 };

// distance of the rotate handle from the top edge, in px
const ROTATE_DISTANCE = 30;


/**
 * Draws the handles for aligning the local image overlay,
 * while the `align-image` mode is active.
 */
export function svgImageOverlayHandles(context: iD.Context): SvgLayer {

    function alignMode() {
        const mode = context.mode() as any;
        return mode?.id === 'align-image' && mode.active() ? mode : null;
    }


    function startDrag(d3_event: PointerEvent, d: AlignImageHandle) {
        // on touch screens, let the image body pan the map, there are separate handles for moving it
        if (d.type === 'body' && d3_event.pointerType === 'touch') return;
        alignMode()?.startDrag(d3_event, { type: d.type, index: d.index });
    }


    function drawHandles(selection: d3.Selection<SVGGElement>) {
        const overlay = context.background().imageOverlay();
        const quad = alignMode() && overlay.isVisible() ? overlay.screenCorners() : null;

        let layer = selection.selectAll<SVGGElement, number>('.layer-image-overlay-handles')
            .data(quad ? [0] : []);

        layer.exit()
            .remove();

        layer = layer.enter()
            .append('g')
            .attr('class', 'layer-image-overlay-handles')
            .merge(layer);

        if (!quad) return;

        const homography = overlay.screenHomography()!;
        const [width, height] = overlay.size();
        const at = (u: number, v: number) => geoHomographyApply(homography, [u * width, v * height]);

        const center = at(0.5, 0.5);
        const top = at(0.5, 0);
        const rotate = geoVecAdd(top, geoVecScale(geoVecNormalize(geoVecSubtract(top, center)), ROTATE_DISTANCE));

        // the outline, which can be dragged to move the image
        layer.selectAll<SVGPathElement, HandleDatum>('.image-overlay-body')
            .data([{ type: 'body', point: center } as HandleDatum])
            .join(enter => enter
                .append('path')
                .attr('class', 'image-overlay-body')
                .on('pointerdown', startDrag)
            )
            .attr('d', `M${quad.map(p => p.join(',')).join('L')}Z`);

        layer.selectAll<SVGLineElement, number>('.image-overlay-rotate-stalk')
            .data([0])
            .join('line')
            .attr('class', 'image-overlay-rotate-stalk')
            .attr('x1', top[0])
            .attr('y1', top[1])
            .attr('x2', rotate[0])
            .attr('y2', rotate[1]);

        const handles: HandleDatum[] = [
            // midpoints of the top, right, bottom, and left edges
            ...([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] as Vec2[]).map(([u, v], index) => (
                { type: 'edge' as const, index, point: at(u, v) }
            )),
            ...quad.map((point, index) => ({ type: 'corner' as const, index, point })),
            { type: 'rotate', point: rotate },
            { type: 'center', point: center }
        ];

        layer.selectAll<SVGGElement, HandleDatum>('.image-overlay-handle')
            .data(handles, d => `${d.type}-${d.index ?? ''}`)
            .join(enter => {
                const g = enter
                    .append('g')
                    .attr('class', d => `image-overlay-handle image-overlay-handle-${d.type}`)
                    .on('pointerdown', startDrag);

                // a larger, invisible target which is easier to hit
                g.append('circle')
                    .attr('class', 'handle-target')
                    .attr('r', 12);

                g.append('circle')
                    .attr('class', 'handle-dot')
                    .attr('r', d => d.type === 'edge' ? 4 : 6);

                return g;
            })
            .attr('transform', d => `translate(${d.point[0]},${d.point[1]})`);
    }

    return drawHandles;
}
