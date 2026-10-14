import { select as d3_select } from 'd3-selection';

import { t, localizer } from '../../core/localizer';
import { modeAlignImage, modeBrowse } from '../../modes';
import { svgIcon } from '../../svg/icon';
import { uiTooltip } from '../tooltip';
import { uiSection } from '../section';


type Message = { type: 'error' | 'warning'; text: string } | null;

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];


export function uiSectionImageOverlay(context: iD.Context) {
    const overlay = context.background().imageOverlay();
    let _message: Message = null;
    let _isLoading = false;

    const section = (uiSection('image-overlay', context) as any)
        .label(() => t.append('background.image_overlay.title'))
        .disclosureContent(renderDisclosureContent)
        .expandedByDefault(false);


    function browse() {
        context.enter(modeBrowse(context) as any);
    }


    function isAligning() {
        return context.mode()?.id === 'align-image';
    }


    function tooltipPlacement() {
        return localizer.textDirection() === 'rtl' ? 'right' : 'left';
    }


    function setMessage(message: Message) {
        _message = message;
        section.reRender();
    }


    function loadImage(file: File | undefined) {
        if (!file) return;
        if (!IMAGE_TYPES.includes(file.type)) {
            setMessage({ type: 'error', text: t('background.image_overlay.errors.type') });
            return;
        }
        if (isAligning()) browse();

        _isLoading = true;
        _message = null;
        section.reRender();
        overlay.load(file)
            .then(() => { _message = null; })
            .catch(() => { _message = { type: 'error', text: t('background.image_overlay.errors.load') }; })
            .finally(() => {
                _isLoading = false;
                section.reRender();
            });
    }


    function importGeoreference(file: File | undefined) {
        if (!file) return;
        file.text()
            .then(text => {
                if (isAligning()) browse();
                const warnings = overlay.applyGeoreference(JSON.parse(text));
                overlay.zoomTo();
                if (warnings.length) {
                    setMessage({
                        type: 'warning',
                        text: warnings.map(w => t(`background.image_overlay.warnings.${w}`)).join(' ')
                    });
                } else {
                    setMessage(null);
                }
            })
            .catch(() => setMessage({ type: 'error', text: t('background.image_overlay.errors.georeference') }));
    }


    function exportGeoreference() {
        const georeference = overlay.georeference();
        if (!georeference) return;

        const basename = overlay.filename().replace(/\.[^.]*$/, '') || 'image';
        const blob = new Blob([JSON.stringify(georeference, null, 2)], { type: 'application/geo+json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${basename}.georef.geojson`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }


    function toggleAlign() {
        if (isAligning()) {
            browse();   // leaving the mode keeps the new alignment
        } else if (overlay.hasImage()) {
            if (!overlay.enabled()) overlay.enabled(true);
            context.enter(modeAlignImage(context) as any);
        }
    }


    function toggleEnabled() {
        if (!overlay.hasImage()) return;
        if (overlay.enabled() && isAligning()) browse();
        overlay.enabled(!overlay.enabled());
    }


    function removeImage() {
        if (isAligning()) browse();
        _message = null;
        overlay.remove();
    }


    // A hidden file input, opened by a button
    function fileInput(selection: d3.Selection<any>, klass: string, accept: string, onChange: (file?: File) => void) {
        selection
            .append('input')
            .attr('type', 'file')
            .attr('class', klass)
            .attr('accept', accept)
            .attr('tabindex', -1)
            .style('display', 'none')
            .on('change', function(this: HTMLInputElement) {
                onChange(this.files?.[0]);
                this.value = '';    // allows choosing the same file again
            });
    }


    function renderDisclosureContent(selection: d3.Selection) {
        let container = selection.selectAll<HTMLDivElement, number>('.image-overlay-container')
            .data([0]);

        container = container.enter()
            .append('div')
            .attr('class', 'image-overlay-container')
            .merge(container);

        container
            .call(renderEmpty)
            .call(renderLoaded)
            .call(renderMessage);
    }


    function renderEmpty(selection: d3.Selection<HTMLDivElement>) {
        const empty = selection.selectAll('.image-overlay-empty')
            .data(overlay.hasImage() ? [] : [0]);

        empty.exit()
            .remove();

        const emptyEnter = empty.enter()
            .insert('div', ':first-child')
            .attr('class', 'image-overlay-empty');

        fileInput(emptyEnter, 'image-overlay-file', IMAGE_TYPES.join(','), loadImage);

        const dropzone = emptyEnter
            .append('button')
            .attr('class', 'image-overlay-dropzone')
            .on('click', function(d3_event: MouseEvent) {
                d3_event.preventDefault();
                (selection.select('.image-overlay-file').node() as HTMLInputElement).click();
            })
            // stop propagation, so that the drop isn't also handled as custom data or local photos
            .on('dragenter dragover', function(this: HTMLElement, d3_event: DragEvent) {
                d3_event.preventDefault();
                d3_event.stopPropagation();
                if (d3_event.dataTransfer) d3_event.dataTransfer.dropEffect = 'copy';
                d3_select(this).classed('dragging', true);
            })
            .on('dragleave', function(this: HTMLElement) {
                d3_select(this).classed('dragging', false);
            })
            .on('drop', function(this: HTMLElement, d3_event: DragEvent) {
                d3_event.preventDefault();
                d3_event.stopPropagation();
                d3_select(this).classed('dragging', false);
                loadImage(d3_event.dataTransfer?.files[0]);
            });

        dropzone
            .call(svgIcon('#iD-icon-load', 'inline'))
            .append('span')
            .attr('class', 'image-overlay-dropzone-text');

        emptyEnter
            .append('p')
            .attr('class', 'image-overlay-info')
            .call(t.append('background.image_overlay.license'));

        selection.selectAll('.image-overlay-dropzone')
            .property('disabled', _isLoading)
            .select('.image-overlay-dropzone-text')
            .text(_isLoading ? t('background.image_overlay.loading') : t('background.image_overlay.add'));
    }


    function renderLoaded(selection: d3.Selection<HTMLDivElement>) {
        let loaded = selection.selectAll<HTMLDivElement, number>('.image-overlay-loaded')
            .data(overlay.hasImage() ? [0] : []);

        loaded.exit()
            .remove();

        const loadedEnter = loaded.enter()
            .append('div')
            .attr('class', 'image-overlay-loaded');

        // the image, with buttons to zoom to and remove it
        const liEnter = loadedEnter
            .append('ul')
            .attr('class', 'layer-list')
            .append('li')
            .attr('class', 'image-overlay-item');

        const labelEnter = liEnter
            .append('label')
            .call((uiTooltip() as any)
                .title(() => t.append('background.image_overlay.enable_tooltip'))
                .placement('top')
            );

        labelEnter
            .append('input')
            .attr('type', 'checkbox')
            .on('change', toggleEnabled);

        labelEnter
            .append('span')
            .attr('class', 'image-overlay-name');

        liEnter
            .append('button')
            .attr('class', 'image-overlay-zoom')
            .call((uiTooltip() as any)
                .title(() => t.append('background.image_overlay.zoom'))
                .placement(tooltipPlacement)
            )
            .on('click', function(d3_event: MouseEvent) {
                d3_event.preventDefault();
                overlay.zoomTo();
            })
            .call(svgIcon('#iD-icon-framed-dot', 'monochrome'));

        liEnter
            .append('button')
            .attr('class', 'image-overlay-remove')
            .call((uiTooltip() as any)
                .title(() => t.append('background.image_overlay.remove'))
                .placement(tooltipPlacement)
            )
            .on('click', function(d3_event: MouseEvent) {
                d3_event.preventDefault();
                removeImage();
            })
            .call(svgIcon('#iD-icon-close', 'monochrome'));

        // opacity slider, styled like the display options
        const opacityEnter = loadedEnter
            .append('label')
            .attr('class', 'display-control image-overlay-opacity');

        opacityEnter
            .call(t.append('background.image_overlay.opacity'))
            .append('span')
            .attr('class', 'display-option-value');

        opacityEnter
            .append('div')
            .attr('class', 'control-wrap')
            .append('input')
            .attr('class', 'display-option-input')
            .attr('type', 'range')
            .attr('min', 0)
            .attr('max', 1)
            .attr('step', 0.01)
            .on('input', function(this: HTMLInputElement) {
                overlay.opacity(+this.value);
                updateOpacityValue(d3_select(this.closest('.image-overlay-loaded') as HTMLElement));
            });

        // alignment buttons
        const alignEnter = loadedEnter
            .append('div')
            .attr('class', 'image-overlay-buttons');

        alignEnter
            .append('button')
            .attr('class', 'image-overlay-align button action')
            .call((uiTooltip() as any)
                .title(() => t.append('background.image_overlay.align_tooltip'))
                .placement('top')
            )
            .on('click', function(d3_event: MouseEvent) {
                d3_event.preventDefault();
                toggleAlign();
            })
            .append('span')
            .attr('class', 'image-overlay-align-label');

        alignEnter
            .append('button')
            .attr('class', 'image-overlay-cancel button secondary-action')
            .on('click', function(d3_event: MouseEvent) {
                d3_event.preventDefault();
                (context.mode() as any).cancel?.();
            })
            .call(t.append('background.image_overlay.cancel'));

        alignEnter
            .append('button')
            .attr('class', 'image-overlay-reset button secondary-action')
            .call((uiTooltip() as any)
                .title(() => t.append('background.image_overlay.reset_tooltip'))
                .placement('top')
            )
            .on('click', function(d3_event: MouseEvent) {
                d3_event.preventDefault();
                if (isAligning()) browse();
                overlay.reset();
            })
            .call(t.append('background.image_overlay.reset'));

        // georeference export and import
        const georefEnter = loadedEnter
            .append('div')
            .attr('class', 'image-overlay-buttons');

        georefEnter
            .append('button')
            .attr('class', 'image-overlay-export button secondary-action')
            .call((uiTooltip() as any)
                .title(() => t.append('background.image_overlay.export_tooltip'))
                .placement('top')
            )
            .on('click', function(d3_event: MouseEvent) {
                d3_event.preventDefault();
                exportGeoreference();
            })
            .call(t.append('background.image_overlay.export'));

        fileInput(georefEnter, 'image-overlay-georef-file', '.geojson,.json,application/geo+json,application/json', importGeoreference);

        georefEnter
            .append('button')
            .attr('class', 'image-overlay-import button secondary-action')
            .call((uiTooltip() as any)
                .title(() => t.append('background.image_overlay.import_tooltip'))
                .placement('top')
            )
            .on('click', function(d3_event: MouseEvent) {
                d3_event.preventDefault();
                (selection.select('.image-overlay-georef-file').node() as HTMLInputElement).click();
            })
            .call(t.append('background.image_overlay.import'));

        // update
        loaded = loadedEnter.merge(loaded);
        if (loaded.empty()) return;

        const aligning = isAligning();

        loaded.select('.image-overlay-item')
            .classed('active', overlay.enabled())
            .select('input')
            .property('checked', overlay.enabled());

        loaded.select('.image-overlay-name')
            .text(overlay.filename())
            .attr('title', overlay.filename());

        loaded.select('.image-overlay-opacity input')
            .property('value', overlay.opacity());
        updateOpacityValue(loaded);

        loaded.select('.image-overlay-align-label')
            .text(aligning ? t('background.image_overlay.done') : t('background.image_overlay.align'));

        loaded.select('.image-overlay-cancel')
            .classed('hide', !aligning);

        loaded.select('.image-overlay-reset')
            .classed('hide', aligning);
    }


    function updateOpacityValue(selection: d3.Selection<any>) {
        selection.select('.image-overlay-opacity .display-option-value')
            .text(`${Math.round(overlay.opacity() * 100)}%`);
    }


    function renderMessage(selection: d3.Selection<HTMLDivElement>) {
        const message = selection.selectAll<HTMLParagraphElement, Message>('.image-overlay-message')
            .data(_message ? [_message] : []);

        message.exit()
            .remove();

        message.enter()
            .append('p')
            .merge(message)
            .attr('class', d => `image-overlay-message image-overlay-${d!.type}`)
            .text(d => d!.text);
    }


    overlay.on('change.uiSectionImageOverlay', () => section.reRender());

    context
        .on('enter.uiSectionImageOverlay', () => section.reRender());

    return section;
}
