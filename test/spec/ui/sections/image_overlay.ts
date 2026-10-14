import { select as d3_select } from 'd3-selection';

// jsdom can't decode images, so pretend that every image is 400×200 px
class FakeImage {
    naturalWidth = 400;
    naturalHeight = 200;
    onload?: () => void;
    get src() { return ''; }
    set src(_: string) { window.setTimeout(() => this.onload?.()); }
}

describe('iD.uiSectionImageOverlay', () => {
    let container: d3.Selection;
    let context: iD.Context;
    let section: any;
    let selection: d3.Selection;

    beforeEach(() => {
        vi.stubGlobal('Image', FakeImage);
        URL.createObjectURL = vi.fn(() => 'blob:image');
        URL.revokeObjectURL = vi.fn();

        container = d3_select('body').append<HTMLElement>('div').attr('class', 'id-container');
        context = iD.coreContext().assetPath('../dist/').init().container(container);
        container
            .append('div')
            .attr('class', 'main-map')
            .call(context.map());
        context.map().dimensions([1000, 500]);
        context.enter(iD.modeBrowse(context) as any);

        section = iD.uiSectionImageOverlay(context).expandedByDefault(true);
        selection = container.append<HTMLElement>('div').call(section.render);
    });

    afterEach(() => {
        context.mode().exit();
        vi.unstubAllGlobals();
        container.remove();
    });

    it('offers to add an image when there is none', () => {
        expect(selection.selectAll('.image-overlay-dropzone').size()).toBe(1);
        expect(selection.selectAll('.image-overlay-loaded').size()).toBe(0);

        const link = selection.select('.image-overlay-info a');
        expect(link.attr('href')).toBe('https://osmfoundation.org/wiki/Licence/Licence_Compatibility');
        expect(link.attr('target')).toBe('_blank');
    });

    it('rejects unsupported file types', () => {
        const input = selection.select('.image-overlay-file').node() as HTMLInputElement;
        Object.defineProperty(input, 'files', { value: [new File([''], 'map.tiff', { type: 'image/tiff' })] });
        input.dispatchEvent(new Event('change'));

        expect(selection.selectAll('.image-overlay-error').size()).toBe(1);
        expect(context.background().imageOverlay().hasImage()).toBe(false);
    });

    it('shows the controls once an image is loaded, and enters the align mode', async () => {
        await context.background().imageOverlay().load(new File([''], 'plan.png', { type: 'image/png' }));

        expect(selection.selectAll('.image-overlay-dropzone').size()).toBe(0);
        expect(selection.select('.image-overlay-name').text()).toBe('plan.png');
        expect(selection.select('.image-overlay-cancel').classed('hide')).toBe(true);

        expect(selection.select('.image-overlay-align').text()).toBe('Align Image');

        iD.utilTriggerEvent(selection.select('.image-overlay-align'), 'click');
        expect(context.mode().id).toBe('align-image');
        expect(selection.select('.image-overlay-align').text()).toBe('Done');
        expect(selection.select('.image-overlay-cancel').classed('hide')).toBe(false);

        iD.utilTriggerEvent(selection.select('.image-overlay-align'), 'click');
        expect(context.mode().id).toBe('browse');
    });

    it('changes the opacity of the image', async () => {
        const overlay = context.background().imageOverlay();
        await overlay.load(new File([''], 'plan.png', { type: 'image/png' }));

        const input = selection.select('.image-overlay-opacity input').node() as HTMLInputElement;
        input.value = '0.25';
        input.dispatchEvent(new Event('input'));

        expect(overlay.opacity()).toBe(0.25);
        expect(selection.select('.image-overlay-opacity .display-option-value').text()).toBe('25%');
    });
});
