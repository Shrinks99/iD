import { select as d3_select } from 'd3-selection';

// jsdom can't decode images, so pretend that every image is 400×200 px
class FakeImage {
    naturalWidth = 400;
    naturalHeight = 200;
    onload?: () => void;
    get src() { return ''; }
    set src(_: string) { window.setTimeout(() => this.onload?.()); }
}

function pointerEvent(type: string, x: number, y: number, init: MouseEventInit = {}) {
    const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, ...init });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    return event as PointerEvent;
}

describe('iD.modeAlignImage', () => {
    let container: d3.Selection;
    let context: iD.Context;
    let overlay: ReturnType<typeof iD.rendererImageOverlay>;

    beforeEach(async () => {
        vi.stubGlobal('Image', FakeImage);
        URL.createObjectURL = vi.fn(() => 'blob:image');
        URL.revokeObjectURL = vi.fn();

        container = d3_select('body').append<HTMLElement>('div');
        context = iD.coreContext().assetPath('../dist/').init().container(container);
        container
            .append('div')
            .attr('class', 'main-map')
            .call(context.map());
        context.map().dimensions([1000, 500]);
        context.map().centerZoom([0, 0], 16);
        context.enter(iD.modeBrowse(context) as any);

        overlay = context.background().imageOverlay();
        await overlay.load(new File([''], 'plan.png', { type: 'image/png' }));
    });

    afterEach(() => {
        context.mode().exit();
        vi.unstubAllGlobals();
        container.remove();
    });

    function screenCorners() {
        return overlay.screenCorners()!.map(p => p.map(v => Math.round(v)));
    }

    function enter() {
        const mode = iD.modeAlignImage(context);
        context.enter(mode as any);
        return mode;
    }

    it('nudges the image with the keyboard', () => {
        enter();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }));
        expect(screenCorners()[0]).toEqual([210, 100]);
    });

    it('restores the previous alignment when cancelled with escape', () => {
        const before = overlay.corners();
        enter();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true }));
        expect(overlay.corners()).not.toEqual(before);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(context.mode().id).toBe('browse');
        expect(overlay.corners()).toEqual(before);
    });

    it('keeps the new alignment when leaving the mode in another way', () => {
        enter();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true }));
        const after = overlay.corners();

        context.enter(iD.modeBrowse(context) as any);
        expect(overlay.corners()).toEqual(after);
    });

    it('warps the image by dragging a corner', () => {
        const mode = enter();
        mode.startDrag(pointerEvent('pointerdown', 200, 100), { type: 'corner', index: 0 });
        window.dispatchEvent(pointerEvent('pointermove', 150, 80));
        window.dispatchEvent(pointerEvent('pointerup', 150, 80));

        expect(screenCorners()).toEqual([[150, 80], [800, 100], [800, 400], [200, 400]]);
    });

    it('scales uniformly when dragging a corner with shift', () => {
        const mode = enter();
        mode.startDrag(pointerEvent('pointerdown', 800, 400), { type: 'corner', index: 2 });
        window.dispatchEvent(pointerEvent('pointermove', 500, 250, { shiftKey: true }));
        window.dispatchEvent(pointerEvent('pointerup', 500, 250));

        expect(screenCorners()).toEqual([[200, 100], [500, 100], [500, 250], [200, 250]]);
    });

    it('rejects drags which would fold the image', () => {
        const mode = enter();
        const before = screenCorners();
        mode.startDrag(pointerEvent('pointerdown', 200, 100), { type: 'corner', index: 0 });
        window.dispatchEvent(pointerEvent('pointermove', 900, 450));   // beyond the opposite corner
        window.dispatchEvent(pointerEvent('pointerup', 900, 450));

        expect(screenCorners()).toEqual(before);
    });

    it('rotates the image around its center', () => {
        const mode = enter();
        // the image center is at [500, 250], start dragging straight above it
        mode.startDrag(pointerEvent('pointerdown', 500, 50), { type: 'rotate' });
        window.dispatchEvent(pointerEvent('pointermove', 700, 250));   // 90° clockwise
        window.dispatchEvent(pointerEvent('pointerup', 700, 250));

        expect(screenCorners()).toEqual([[650, -50], [650, 550], [350, 550], [350, -50]]);
    });

    it('ends the drag if the button was released without a pointerup event', () => {
        const mode = enter();
        mode.startDrag(pointerEvent('pointerdown', 200, 100), { type: 'body' });
        window.dispatchEvent(pointerEvent('pointermove', 250, 150));
        const after = screenCorners();

        window.dispatchEvent(pointerEvent('pointermove', 300, 200, { buttons: 0 }));
        expect(screenCorners()).toEqual(after);
        window.dispatchEvent(pointerEvent('pointermove', 350, 250));
        expect(screenCorners()).toEqual(after);
    });

    it('ends the drag when the window loses focus', () => {
        const mode = enter();
        mode.startDrag(pointerEvent('pointerdown', 200, 100), { type: 'body' });
        window.dispatchEvent(new FocusEvent('blur'));
        const before = screenCorners();
        window.dispatchEvent(pointerEvent('pointermove', 300, 200));
        expect(screenCorners()).toEqual(before);

        // a new drag can be started
        mode.startDrag(pointerEvent('pointerdown', 200, 100), { type: 'body' });
        window.dispatchEvent(pointerEvent('pointermove', 300, 200));
        expect(screenCorners()[0]).toEqual([300, 200]);
    });

    it('ignores drags after leaving the mode', () => {
        const mode = enter();
        context.enter(iD.modeBrowse(context) as any);
        const before = screenCorners();
        mode.startDrag(pointerEvent('pointerdown', 200, 100), { type: 'body' });
        window.dispatchEvent(pointerEvent('pointermove', 300, 200));
        expect(screenCorners()).toEqual(before);
    });
});
