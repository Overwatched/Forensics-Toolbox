// Avkodarens tråd: läggs efter libheif-bundle.js (som ger globalen libheif) i tools/_shared/vendor/libheif/
// libheif-worker.js av scripts/vendor-libheif.js. Ett meddelande { id, bytes, preview, maxSide, raw } ger
// { id, ok, blob | rgba, width, height, from, w, h } eller { id, ok: false, error }.
//  - preview: den största bilden i filen som varken är huvudbilden eller dold och är mindre än huvudbilden
//    (iPhone lägger en på 240 × 320 bredvid rutnätet), annars huvudbilden.
//  - maxSide: bilden förminskas så att den längsta sidan blir högst så många bildpunkter.
//  - raw: pixlarna (RGBA) i stället för en JPEG, för testerna, som saknar OffscreenCanvas.
var FT_HEIF = null;
// libheif() ger modulen färdig (WebAssembly kompileras direkt i en worker). Ett annat bygge kan ge ett löfte.
var FT_HEIF_BOOT = Promise.resolve().then(function () { return libheif(); }).then(function (m) { FT_HEIF = m; });

function ftHeifPreview(M, ctx, W, H) {
    var ids = Array.from(M.heif_context_get_list_of_item_IDs(ctx) || []), best = null;
    ids.forEach(function (id) {
        var h;
        try { h = M.heif_js_context_get_image_handle(ctx, id); } catch (e) { return; }
        if (!h || h.code || M.heif_image_handle_is_primary_image(h) || M.heif_item_is_item_hidden(ctx, id)) return;
        var w = M.heif_image_handle_get_width(h), hh = M.heif_image_handle_get_height(h);
        if (w >= W || hh >= H || w < 16 || hh < 16) return;
        if (!best || w * hh > best.w * best.h) best = { h: h, w: w, h2: hh };
    });
    return best;
}

async function ftHeifDecode(d) {
    var M = FT_HEIF, ctx = M.heif_context_alloc();
    if (!ctx) throw new Error('Avkodaren fick inget minne för HEIC-filen.');
    try {
        var err = M.heif_context_read_from_memory(ctx, new Uint8Array(d.bytes));
        // Felkoden är ett värde i en uppräkning, också när allt gick bra.
        if (!err || err.code !== M.heif_error_code.heif_error_Ok) throw new Error('HEIC-filen kunde inte tolkas: ' + ((err && err.message) || 'okänt fel') + '.');
        var h = M.heif_js_context_get_primary_image_handle(ctx);
        if (!h || h.code) throw new Error('HEIC-filen har ingen huvudbild.');
        var W = M.heif_image_handle_get_width(h), H = M.heif_image_handle_get_height(h), from = 'primary';
        if (d.preview) { var p = ftHeifPreview(M, ctx, W, H); if (p) { h = p.h; from = 'preview'; } }
        var img = await M.heif_js_decode_image2(h, M.heif_colorspace.heif_colorspace_RGB, M.heif_chroma.heif_chroma_interleaved_RGBA);
        if (!img || img.code || !img.channels) throw new Error('Bilden i HEIC-filen kunde inte avkodas.');
        var ch = img.channels.filter(function (c) { return c.id === M.heif_channel.heif_channel_interleaved; })[0];
        if (!ch) throw new Error('Bilden i HEIC-filen har ett format som inte stöds.');
        var w = ch.width, hh = ch.height, rgba = new Uint8ClampedArray(w * hh * 4);
        if (ch.stride === w * 4) rgba.set(ch.data.subarray(0, w * hh * 4));
        else for (var y = 0; y < hh; y++) rgba.set(ch.data.subarray(y * ch.stride, y * ch.stride + w * 4), y * w * 4);
        if (img.image) M.heif_image_release(img.image);
        return { rgba: rgba, w: w, h: hh, width: W, height: H, from: from };
    } finally {
        M.heif_context_free(ctx);
    }
}

async function ftHeifJpeg(r, maxSide) {
    var c = new OffscreenCanvas(r.w, r.h);
    c.getContext('2d').putImageData(new ImageData(r.rgba, r.w, r.h), 0, 0);
    var scale = maxSide ? Math.min(1, maxSide / Math.max(r.w, r.h)) : 1;
    if (scale < 1) {
        var s = new OffscreenCanvas(Math.max(1, Math.round(r.w * scale)), Math.max(1, Math.round(r.h * scale)));
        var g = s.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(c, 0, 0, s.width, s.height);
        c = s;
    }
    return { blob: await c.convertToBlob({ type: 'image/jpeg', quality: 0.88 }), w: c.width, h: c.height };
}

self.onmessage = function (e) {
    var d = e.data || {};
    FT_HEIF_BOOT.then(function () { return ftHeifDecode(d); }).then(async function (r) {
        if (d.raw) return self.postMessage({ id: d.id, ok: true, rgba: r.rgba, w: r.w, h: r.h, width: r.width, height: r.height, from: r.from }, [r.rgba.buffer]);
        var j = await ftHeifJpeg(r, d.maxSide);
        self.postMessage({ id: d.id, ok: true, blob: j.blob, w: j.w, h: j.h, width: r.width, height: r.height, from: r.from });
    }).catch(function (err) {
        self.postMessage({ id: d.id, ok: false, error: String(err && err.message || err) });
    });
};
self.postMessage({ ready: true });
