import { dispatch as d3_dispatch } from 'd3-dispatch';

import {
    geoExtent, geoHomographySquareToQuad, geoHomographyToCssMatrix3d, geoQuadIsValid
} from '../geo';
import { localizer } from '../core/localizer';
import { utilRebind } from '../util/rebind';
import type { Mat3, Quad } from '../geo/homography';
import type { Vec2 } from '../geo/vector';


// Longest side of the image we display, larger images are downscaled.
// 4096² stays below the GPU texture and canvas size limits of most browsers.
const MAX_SIZE = 4096;

const FORMAT = 'iD-image-georeference';
const VERSION = 1;

// The limit of Web Mercator. Corners must stay within it, so that exported positions can be imported again.
const MAX_LAT = 85.06;

export interface ImageGeoreference {
    type: 'Feature';
    geometry: { type: 'Polygon'; coordinates: Vec2[][] };
    properties: {
        format: typeof FORMAT;
        version: number;
        filename: string;
        width: number;
        height: number;
    };
}

export type ParsedImageGeoreference = ImageGeoreference['properties'] & { corners: Quad };


function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image could not be decoded'));
        img.src = url;
    });
}


function downscale(img: HTMLImageElement, width: number, height: number, type: string): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
    // keep transparency for anything that isn't a JPEG
    const outType = type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image could not be resized')), outType, 0.92);
    });
}


function clamp(val: number, min: number, max: number) {
    return Math.min(Math.max(val, min), max);
}


// Positions may have a third value (altitude), which is ignored
function isLoc(val: unknown): val is Vec2 {
    return Array.isArray(val) && val.length >= 2 &&
        Number.isFinite(val[0]) && Number.isFinite(val[1]) &&
        Math.abs(val[0]) <= 180 && Math.abs(val[1]) <= MAX_LAT;
}


/**
 * Parses an exported georeference.
 * The corners are read from the polygon, so that it can be edited in other tools.
 * Its ring starts at the top-left corner, and may be wound in either direction.
 * Returns `null` if it isn't a valid georeference.
 */
export function rendererParseImageGeoreference(json: unknown): ParsedImageGeoreference | null {
    const { geometry, properties: props } = (json as Partial<ImageGeoreference> | undefined) || {};
    if (!props || props.format !== FORMAT || typeof props.version !== 'number' || props.version > VERSION) {
        return null;
    }

    const ring: unknown = geometry?.type === 'Polygon' && geometry.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length !== 5 || !ring.every(isLoc)) return null;
    const locs = ring.map(([lon, lat]) => [lon, lat] as Vec2);
    if (locs[0][0] !== locs[4][0] || locs[0][1] !== locs[4][1]) return null;

    // shoelace formula, positive for counterclockwise rings
    let area = 0;
    for (let i = 0; i < 4; i++) {
        area += locs[i][0] * locs[i + 1][1] - locs[i + 1][0] * locs[i][1];
    }
    const [tl, a, br, b] = locs;
    const corners: Quad = area > 0 ? [tl, b, br, a] : [tl, a, br, b];

    // latitude grows upwards, the quad check expects screen space
    const flipped = corners.map(([lon, lat]) => [lon, -lat]) as Quad;
    if (!geoQuadIsValid(flipped, 0)) return null;

    return { ...props, corners };
}


/**
 * A local image shown above the background imagery.
 * Its position is stored as the lon/lat locations of its four corners,
 * which allows rotating, scaling, and perspective correction.
 */
export function rendererImageOverlay(context: iD.Context) {
    const dispatch = d3_dispatch('change');
    let _name = '';
    let _url: string | null = null;
    let _width = 0;
    let _height = 0;
    let _corners: Quad | null = null;
    let _opacity = 0.6;
    let _enabled = true;


    function overlay() {}


    function revoke() {
        if (_url) URL.revokeObjectURL(_url);
        _url = null;
    }


    overlay.hasImage = () => !!_url && !!_corners;

    overlay.isVisible = () => overlay.hasImage() && _enabled && !context.inIntro();

    overlay.filename = () => _name;

    overlay.url = () => _url;

    overlay.size = (): Vec2 => [_width, _height];


    /** Reads an image file, replacing any image which was shown before */
    overlay.load = async function(file: Blob & { name?: string }) {
        let url = URL.createObjectURL(file);
        let width: number, height: number;
        try {
            const img = await loadImage(url);
            width = img.naturalWidth;
            height = img.naturalHeight;
            if (!width || !height) throw new Error('Image is empty');

            const scale = MAX_SIZE / Math.max(width, height);
            if (scale < 1) {
                width = Math.round(width * scale);
                height = Math.round(height * scale);
                const blob = await downscale(img, width, height, file.type);
                URL.revokeObjectURL(url);
                url = URL.createObjectURL(blob);
            }
        } catch (err) {
            URL.revokeObjectURL(url);
            throw err;
        }

        revoke();
        _url = url;
        _name = file.name || '';
        _width = width;
        _height = height;
        _enabled = true;
        overlay.fitToView();
        dispatch.call('change');
        return overlay;
    };


    overlay.remove = function() {
        revoke();
        _name = '';
        _width = 0;
        _height = 0;
        _corners = null;
        dispatch.call('change');
        return overlay;
    };


    /** Places the image in the middle of the visible part of the map */
    overlay.fitToView = function() {
        if (!_width || !_height) return overlay;
        const container = context.container();
        const height = (selector: string) => (container.select(selector).node() as HTMLElement | null)?.offsetHeight || 0;
        const pane = (container.select('.map-panes .map-pane.shown').node() as HTMLElement | null)?.offsetWidth || 0;
        const top = height('.top-toolbar');
        const bottom = height('.map-footer-bar');
        const [mapWidth, mapHeight] = context.map().dimensions();

        // the panes are on the left side of the map in right-to-left languages
        const left = localizer.textDirection() === 'rtl' ? pane : 0;
        const availWidth = Math.max(mapWidth - pane, 1);
        const availHeight = Math.max(mapHeight - top - bottom, 1);

        // when zoomed out, keep the image within the bounds of the world
        const projection = context.projection;
        const [minX, minY] = projection([-180, MAX_LAT]);
        const [maxX, maxY] = projection([180, -MAX_LAT]);

        const scale = Math.min(
            0.6 * Math.min(availWidth / _width, availHeight / _height),
            (maxX - minX) / _width,
            (maxY - minY) / _height
        );
        const dx = _width * scale / 2;
        const dy = _height * scale / 2;
        const cx = clamp(left + availWidth / 2, minX + dx, maxX - dx);
        const cy = clamp(top + availHeight / 2, minY + dy, maxY - dy);

        // clamping again guards against rounding errors of the projection
        _corners = ([
            [cx - dx, cy - dy],
            [cx + dx, cy - dy],
            [cx + dx, cy + dy],
            [cx - dx, cy + dy]
        ] as Vec2[]).map(p => {
            const [lon, lat] = projection.invert(p);
            return [clamp(lon, -180, 180), clamp(lat, -MAX_LAT, MAX_LAT)];
        }) as Quad;
        return overlay;
    };


    overlay.reset = function() {
        overlay.fitToView();
        dispatch.call('change');
        return overlay;
    };


    /**
     * The lon/lat locations of the corners of the image (top-left, top-right,
     * bottom-right, bottom-left). Setting them doesn't trigger a `change` event,
     * so that they can be updated continuously while dragging.
     */
    function corners(): Quad | null;
    function corners(val: Quad): typeof overlay;
    function corners(val?: Quad) {
        if (val === undefined) return _corners && _corners.map(c => [...c]) as Quad;
        _corners = val.map(c => [...c]) as Quad;
        return overlay;
    }
    overlay.corners = corners;


    /** The corners projected to screen coordinates */
    overlay.screenCorners = (): Quad | null => _corners && _corners.map(c => context.projection(c)) as Quad;


    /** Transform from image pixels to screen coordinates */
    overlay.screenHomography = (): Mat3 | null => {
        const quad = overlay.screenCorners();
        return quad && geoHomographySquareToQuad(quad, _width, _height);
    };


    overlay.extent = () => {
        if (!_corners) return geoExtent();
        return _corners.reduce((extent, c) => extent.extend(geoExtent(c)), geoExtent(_corners[0]));
    };


    overlay.zoomTo = function() {
        if (overlay.hasImage()) context.map().zoomToEase(overlay.extent());
        return overlay;
    };


    function enabled(): boolean;
    function enabled(val: boolean): typeof overlay;
    function enabled(val?: boolean) {
        if (val === undefined) return _enabled;
        _enabled = val;
        dispatch.call('change');
        return overlay;
    }
    overlay.enabled = enabled;


    // Opacity changes don't need a full redraw of the map
    function opacity(): number;
    function opacity(val: number): typeof overlay;
    function opacity(val?: number) {
        if (val === undefined) return _opacity;
        _opacity = Math.min(Math.max(val, 0), 1);
        context.container()?.selectAll('.layer-image-overlay').style('opacity', _opacity);
        return overlay;
    }
    overlay.opacity = opacity;


    // The file name is not published, it could contain personal information
    overlay.imageryUsed = () => 'Local image';


    /** Notifies listeners about a change of the corners */
    overlay.changed = function() {
        dispatch.call('change');
        return overlay;
    };


    overlay.georeference = (): ImageGeoreference | null => {
        if (!_corners) return null;
        const [tl, tr, br, bl] = _corners;
        return {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [[tl, bl, br, tr, tl]]   // counterclockwise, as required by RFC 7946
            },
            properties: {
                format: FORMAT,
                version: VERSION,
                filename: _name,
                width: _width,
                height: _height
            }
        };
    };


    /**
     * Places the image according to an exported georeference.
     * Returns warnings about mismatches between the georeference and the image,
     * and throws if the georeference is invalid.
     */
    overlay.applyGeoreference = function(json: unknown) {
        const props = rendererParseImageGeoreference(json);
        if (!props) throw new Error('Invalid georeference');

        const warnings: ('filename' | 'aspect')[] = [];
        if (props.filename && _name && props.filename !== _name) {
            warnings.push('filename');
        }
        if (props.width > 0 && props.height > 0 && _width && _height &&
            Math.abs(props.width / props.height - _width / _height) > 0.01) {
            warnings.push('aspect');
        }

        _corners = props.corners;
        dispatch.call('change');
        return warnings;
    };


    /** Draws the image into the map's supersurface */
    overlay.render = function(selection: d3.Selection) {
        let layer = selection.selectAll<HTMLDivElement, number>('.layer-image-overlay')
            .data(overlay.isVisible() ? [0] : []);

        layer.exit()
            .remove();

        const layerEnter = layer.enter()
            .append('div')
            .attr('class', 'layer layer-image-overlay');

        layerEnter
            .append('img')
            .attr('alt', '')
            .attr('draggable', 'false');

        layer = layerEnter.merge(layer);
        if (!overlay.isVisible()) return;

        layer.style('opacity', _opacity);

        const img = layer.select('img');
        if (img.attr('src') !== _url) img.attr('src', _url);

        const quad = overlay.screenCorners()!;
        const [width, height] = context.map().dimensions();
        const xs = quad.map(p => p[0]);
        const ys = quad.map(p => p[1]);
        const offscreen = Math.max(...xs) < 0 || Math.min(...xs) > width ||
            Math.max(...ys) < 0 || Math.min(...ys) > height;

        if (offscreen || !geoQuadIsValid(quad, 0)) {
            img.style('display', 'none');
            return;
        }

        img
            .style('display', null)
            .style('width', `${_width}px`)
            .style('height', `${_height}px`)
            .style('transform', geoHomographyToCssMatrix3d(geoHomographySquareToQuad(quad, _width, _height)));
    };


    /**
     * Redraws just the image and its alignment handles. Used while dragging, when
     * redrawing the whole map on each pointer move would be too slow.
     */
    overlay.redrawNow = function() {
        const map = context.map();
        // during a zoom or pan gesture the map redraws itself once the gesture ends
        if (map.isTransformed()) return overlay;

        overlay.render(context.container().select('.main-map > .supersurface'));
        const handles = context.layers().layer('image-overlay');
        if (handles) {
            context.surface().selectAll('.data-layer.image-overlay').call(handles);
        }
        return overlay;
    };


    return utilRebind(overlay, dispatch, 'on') as unknown as typeof overlay & {
        on(type: 'change' | `change.${string}`, callback: (() => void) | null): typeof overlay;
    };
}
