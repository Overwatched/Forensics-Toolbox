// bcrypt ($2a$, $2b$, $2y$) i ren JavaScript: kontrollera en kod mot en hash, och pröva många koder i flera
// trådar. Används för Snapchats kod till My Eyes Only på Android (memories.db, memories_meo_confidential), som är en
// bcrypt-hash med kostnad 6 över en kod med fyra siffror. Testas i Node (bcrypt.test.js) mot hashar från Pythons bcrypt.
//
//   Bcrypt.parse(hash)                     → { variant, cost, salt (16 byte), sum (23 byte) } eller null
//   Bcrypt.hash(kod, saltBytes, kostnad)   → hashen som text ($2a$)
//   Bcrypt.check(kod, hash)                → true om koden ger hashen
//   Bcrypt.crack(hash, koder, { onProgress(prövade, alla), workers, signal }) → Promise<koden eller null>
//
// Blowfish-konstanterna är decimalerna i pi i hex (P-tabellen och de fyra S-tabellerna i följd), som i Blowfish.
(function (root) {
    'use strict';

    // Allt som en tråd behöver ligger i make(), så att samma kod kan köras i en worker.
    function make() {
        var PI = (
            '243f6a8885a308d313198a2e03707344a4093822299f31d0082efa98ec4e6c89452821e638d01377be5466cf34e90c6c' +
            'c0ac29b7c97c50dd3f84d5b5b54709179216d5d98979fb1bd1310ba698dfb5ac2ffd72dbd01adfb7b8e1afed6a267e96' +
            'ba7c9045f12c7f9924a19947b3916cf70801f2e2858efc16636920d871574e69a458fea3f4933d7e0d95748f728eb658' +
            '718bcd5882154aee7b54a41dc25a59b59c30d5392af26013c5d1b023286085f0ca417918b8db38ef8e79dcb0603a180e' +
            '6c9e0e8bb01e8a3ed71577c1bd314b2778af2fda55605c60e65525f3aa55ab945748986263e8144055ca396a2aab10b6' +
            'b4cc5c341141e8cea15486af7c72e993b3ee1411636fbc2a2ba9c55d741831f6ce5c3e169b87931eafd6ba336c24cf5c' +
            '7a325381289586773b8f48986b4bb9afc4bfe81b6628219361d809ccfb21a991487cac605dec8032ef845d5de98575b1' +
            'dc262302eb651b8823893e81d396acc50f6d6ff383f442392e0b4482a484200469c8f04a9e1f9b5e21c66842f6e96c9a' +
            '670c9c61abd388f06a51a0d2d8542f68960fa728ab5133a36eef0b6c137a3be4ba3bf0507efb2a98a1f1651d39af0176' +
            '66ca593e82430e888cee8619456f9fb47d84a5c33b8b5ebee06f75d885c12073401a449f56c16aa64ed3aa62363f7706' +
            '1bfedf72429b023d37d0d724d00a1248db0fead349f1c09b075372c980991b7b25d479d8f6e8def7e3fe501ab6794c3b' +
            '976ce0bd04c006bac1a94fb6409f60c45e5c9ec2196a246368fb6faf3e6c53b51339b2eb3b52ec6f6dfc511f9b30952c' +
            'cc814544af5ebd09bee3d004de334afd660f2807192e4bb3c0cba85745c8740fd20b5f39b9d3fbdb5579c0bd1a60320a' +
            'd6a100c6402c7279679f25fefb1fa3cc8ea5e9f8db3222f83c7516dffd616b152f501ec8ad0552ab323db5fafd238760' +
            '53317b483e00df829e5c57bbca6f8ca01a87562edf1769dbd542a8f6287effc3ac6732c68c4f5573695b27b0bbca58c8' +
            'e1ffa35db8f011a010fa3d98fd2183b84afcb56c2dd1d35b9a53e479b6f84565d28e49bc4bfb9790e1ddf2daa4cb7e33' +
            '62fb1341cee4c6e8ef20cada36774c01d07e9efe2bf11fb495dbda4dae909198eaad8e716b93d5a0d08ed1d0afc725e0' +
            '8e3c5b2f8e7594b78ff6e2fbf2122b648888b812900df01c4fad5ea0688fc31cd1cff191b3a8c1ad2f2f2218be0e1777' +
            'ea752dfe8b021fa1e5a0cc0fb56f74e818acf3d6ce89e299b4a84fe0fd13e0b77cc43b81d2ada8d9165fa26680957705' +
            '93cc7314211a1477e6ad206577b5fa86c75442f5fb9d35cfebcdaf0c7b3e89a0d6411bd3ae1e7e4900250e2d2071b35e' +
            '226800bb57b8e0af2464369bf009b91e5563911d59dfa6aa78c14389d95a537f207d5ba202e5b9c5832603766295cfa9' +
            '11c819684e734a41b3472dca7b14a94a1b5100529a532915d60f573fbc9bc6e42b60a47681e6740008ba6fb5571be91f' +
            'f296ec6b2a0dd915b6636521e7b9f9b6ff34052ec585566453b02d5da99f8fa108ba47996e85076a4b7a70e9b5b32944' +
            'db75092ec4192623ad6ea6b049a7df7d9cee60b88fedb266ecaa8c71699a17ff5664526cc2b19ee1193602a575094c29' +
            'a0591340e4183a3e3f54989a5b429d656b8fe4d699f73fd6a1d29c07efe830f54d2d38e6f0255dc14cdd20868470eb26' +
            '6382e9c6021ecc5e09686b3f3ebaefc93c9718146b6a70a1687f358452a0e286b79c5305aa5007373e07841c7fdeae5c' +
            '8e7d44ec5716f2b8b03ada37f0500c0df01c1f040200b3ffae0cf51a3cb574b225837a58dc0921bdd19113f97ca92ff6' +
            '9432477322f547013ae5e58137c2dadcc8b576349af3dda7a94461460fd0030eecc8c73ea4751e41e238cd993bea0e2f' +
            '3280bba1183eb3314e548b384f6db9086f420d03f60a04bf2cb8129024977c795679b072bcaf89afde9a771fd9930810' +
            'b38bae12dccf3f2e5512721f2e6b7124501adde69f84cd877a5847187408da17bc9f9abce94b7d8cec7aec3adb851dfa' +
            '63094366c464c3d2ef1c18473215d908dd433b3724c2ba1612a14d432a65c45150940002133ae4dd71dff89e10314e55' +
            '81ac77d65f11199b043556f1d7a3c76b3c11183b5924a509f28fe6ed97f1fbfa9ebabf2c1e153c6e86e34570eae96fb1' +
            '860e5e0a5a3e2ab3771fe71c4e3d06fa2965dcb999e71d0f803e89d65266c8252e4cc9789c10b36ac6150eba94e2ea78' +
            'a5fc3c531e0a2df4f2f74ea7361d2b3d1939260f19c279605223a708f71312b6ebadfe6eeac31f66e3bc4595a67bc883' +
            'b17f37d1018cff28c332ddefbe6c5aa56558218568ab9802eecea50fdb2f953b2aef7dad5b6e2f841521b62829076170' +
            'ecdd4775619f151013cca830eb61bd960334fe1eaa0363cfb5735c904c70a239d59e9e0bcbaade14eecc86bc60622ca7' +
            '9cab5cabb2f3846e648b1eaf19bdf0caa02369b9655abb5040685a323c2ab4b3319ee9d5c021b8f79b540b19875fa099' +
            '95f7997e623d7da8f837889a97e32d7711ed935f166812810e358829c7e61fd696dedfa17858ba9957f584a51b227263' +
            '9b83c3ff1ac24696cdb30aeb532e30548fd948e46dbc312858ebf2ef34c6ffeafe28ed61ee7c3c735d4a14d9e864b7e3' +
            '42105d14203e13e045eee2b6a3aaabeadb6c4f15facb4fd0c742f442ef6abbb5654f3b1d41cd2105d81e799e86854dc7' +
            'e44b476a3d816250cf62a1f25b8d2646fc8883a0c1c7b6a37f1524c369cb749247848a0b5692b285095bbf00ad19489d' +
            '1462b17423820e0058428d2a0c55f5ea1dadf43e233f70613372f0928d937e41d65fecf16c223bdb7cde3759cbee7460' +
            '4085f2a7ce77326ea607808419f8509ee8efd85561d99735a969a7aac50c06c25a04abfc800bcadc9e447a2ec3453484' +
            'fdd567050e1e9ec9db73dbd3105588cd675fda79e3674340c5c43465713e38d83d28f89ef16dff20153e21e78fb03d4a' +
            'e6e39f2bdb83adf7e93d5a68948140f7f64c261c94692934411520f77602d4f7bcf46b2ed4a20068d40824713320f46a' +
            '43b7d4b7500061af1e39f62e9724454614214f74bf8b88404d95fc1d96b591af70f4ddd366a02f45bfbc09ec03bd9785' +
            '7fac6dd031cb850496eb27b355fd3941da2547e6abca0a9a28507825530429f40a2c86dae9b66dfb68dc1462d7486900' +
            '680ec0a427a18dee4f3ffea2e887ad8cb58ce0067af4d6b6aace1e7cd3375fecce78a399406b2a4220fe9e35d9f385b9' +
            'ee39d7ab3b124e8b1dc9faf74b6d185626a36631eae397b23a6efa74dd5b43326841e7f7ca7820fbfb0af54ed8feb397' +
            '454056acba48952755533a3a20838d87fe6ba9b7d096954b55a867bca1159a58cca9296399e1db33a62a4a563f3125f9' +
            '5ef47e1c9029317cfdf8e80204272f7080bb155c05282ce395c11548e4c66d2248c1133fc70f86dc07f9c9ee41041f0f' +
            '404779a45d886e17325f51ebd59bc0d1f2bcc18f41113564257b7834602a9c60dff8e8a31f636c1b0e12b4c202e1329e' +
            'af664fd1cad181156b2395e0333e92e13b240b62eebeb92285b2a20ee6ba0d99de720c8c2da2f728d012784595b794fd' +
            '647d0862e7ccf5f05449a36f877d48fac39dfd27f33e8d1e0a476341992eff743a6f6eabf4f8fd37a812dc60a1ebddf8' +
            '991be14cdb6e6b0dc67b55106d672c372765d43bdcd0e804f1290dc7cc00ffa3b5390f92690fed0b667b9ffbcedb7d9c' +
            'a091cf0bd9155ea3bb132f88515bad247b9479bf763bd6eb37392eb3cc1159798026e297f42e312d6842ada7c66a2b3b' +
            '12754ccc782ef11c6a124237b79251e706a1bbe64bfb63501a6b101811caedfa3d25bdd8e2e1c3c9444216590a121386' +
            'd90cec6ed5abea2a64af674eda86a85fbebfe98864e4c3fe9dbc8057f0f7c08660787bf86003604dd1fd8346f6381fb0' +
            '7745ae04d736fccc83426b33f01eab71b08041873c005e5f77a057bebde8ae2455464299bf582e614e58f48ff2ddfda2' +
            'f474ef388789bdc25366f9c3c8b38e74b475f25546fcd9b97aeb26618b1ddf84846a0e79915f95e2466e598e20b45770' +
            '8cd55591c902de4cb90bace1bb8205d011a862487574a99eb77f19b6e0a9dc09662d09a1c4324633e85a1f0209f0be8c' +
            '4a99a0251d6efe101ab93d1d0ba5a4dfa186f20f2868f169dcb7da83573906fea1e2ce9b4fcd7f5250115e01a70683fa' +
            'a002b5c40de6d0279af88c27773f8641c3604c0661a806b5f0177a28c0f586e0006058aa30dc7d6211e69ed72338ea63' +
            '53c2dd94c2c21634bbcbee5690bcb6deebfc7da1ce591d766f05e4094b7c018839720a3d7c927c2486e3725f724d9db9' +
            '1ac15bb4d39eb8fced54557808fca5b5d83d7cd34dad0fc41e50ef5eb161e6f8a28514d96c51133c6fd5c7e756e14ec4' +
            '362abfceddc6c837d79a323492638212670efa8e406000e03a39ce37d3faf5cfabc277375ac52d1b5cb0679e4fa33742' +
            'd382274099bc9bbed5118e9dbf0f7315d62d1c7ec700c47bb78c1b6b21a19045b26eb1be6a366eb45748ab2fbc946e79' +
            'c6a376d26549c2c8530ff8ee468dde7dd5730a1d4cd04dc62939bbdba9ba4650ac9526e8be5ee304a1fad5f06a2d519a' +
            '63ef8ce29a86ee22c089c2b843242ef6a51e03aa9cf2d0a483c061ba9be96a4d8fe51550ba645bd62826a2f9a73a3ae1' +
            '4ba99586ef5562e9c72fefd3f752f7da3f046f6977fa0a5980e4a91587b086019b09e6ad3b3ee593e990fd5a9e34d797' +
            '2cf0b7d9022b8b5196d5ac3a017da67dd1cf3ed67c7d2d281f9f25cfadf2b89b5ad6b4725a88f54ce029ac71e019a5e6' +
            '47b0acfded93fa9be8d3c48d283b57ccf8d5662979132e28785f0191ed756055f7960e44e3d35e8c15056dd488f46dba' +
            '03a161250564f0bdc3eb9e153c9057a297271aeca93a072a1b3f6d9b1e6321f5f59c66fb26dcf3197533d928b155fdf5' +
            '035634828aba3cbb28517711c20ad9f8abcc5167ccad925f4de817513830dc8e379d58629320f991ea7a90c2fb3e7bce' +
            '5121ce64774fbe32a8b6e37ec3293d4648de53696413e680a2ae0810dd6db22469852dfd09072166b39a460a6445c0dd' +
            '586cdecf1c20c8ae5bbef7dd1b588d40ccd2017f6bb4e3bbdda26a7e3a59ff453e350a44bcb4cdd572eacea8fa6484bb' +
            '8d6612aebf3c6f47d29be463542f5d9eaec2771bf64e6370740e0d8de75b1357f8721671af537d5d4040cb084eb4e2cc' +
            '34d2466a0115af84e1b0042895983a1d06b89fb4ce6ea0486f3f3b823520ab82011a1d4b277227f8611560b1e7933fdc' +
            'bb3a792b344525bda08839e151ce794b2f32c9b7a01fbac9e01cc87ebcc7d1f6cf0111c3a1e8aac71a908749d44fbd9a' +
            'd0dadecbd50ada380339c32ac69136678df9317ce0b12b4ff79e59b743f5bb3af2d519ff27d9459cbf97222c15e6fc2a' +
            '0f91fc719b941525fae59361ceb69cebc2a8645912baa8d1b6c1075ee3056a0c10d25065cb03a442e0ec6e0e1698db3b' +
            '4c98a0be3278e9649f1f9532e0d392dfd3a0342b8971f21e1b0a74414ba3348cc5be7120c37632d8df359f8d9b992f2e' +
            'e60b6f470fe3f11de54cda541edad891ce6279cfcd3e7e6f1618b166fd2c1d05848fd2c5f6fb2299f523f357a6327623' +
            '93a8353156cccd02acf081625a75ebb56e16369788d273ccde96629281b949d04c50901b71c65614e6c6c7bd327a140a' +
            '45e1d006c3f27b9ac9aa53fd62a80f00bb25bfe235bdd2f671126905b2040222b6cbcf7ccd769c2b53113ec01640e3d3' +
            '38abbd602547adf0ba38209cf746ce7677afa1c52075606085cbfe4e8ae88dd87aaaf9b04cf9aa7e1948c25c02fb8a8c' +
            '01c36ae4d6ebe1f990d4f869a65cdea03f09252dc208e69fb74e6132ce77e25b578fdfe33ac372e6');
        var ALPHA = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        var INIT = new Int32Array(1042);
        for (var w = 0; w < 1042; w++) INIT[w] = parseInt(PI.substr(w * 8, 8), 16) | 0;
        var MAGIC = 'OrpheanBeholderScryDoubt';

        function b64decode(s, len) {
            var out = new Uint8Array(len), o = 0, i = 0;
            var v = function (c) { var k = ALPHA.indexOf(c); if (k < 0) throw new Error('Tecknet ' + c + ' finns inte i bcrypts base64'); return k; };
            while (o < len) {
                var c1 = v(s[i++]), c2 = v(s[i++]);
                out[o++] = (c1 << 2) | ((c2 & 0x30) >> 4);
                if (o >= len) break;
                var c3 = v(s[i++]);
                out[o++] = ((c2 & 0x0f) << 4) | ((c3 & 0x3c) >> 2);
                if (o >= len) break;
                var c4 = v(s[i++]);
                out[o++] = ((c3 & 0x03) << 6) | c4;
            }
            return out;
        }
        function b64encode(b, len) {
            var s = '', i = 0;
            while (i < len) {
                var c1 = b[i++];
                s += ALPHA[c1 >> 2];
                c1 = (c1 & 0x03) << 4;
                if (i >= len) { s += ALPHA[c1]; break; }
                var c2 = b[i++];
                s += ALPHA[c1 | (c2 >> 4)];
                c1 = (c2 & 0x0f) << 2;
                if (i >= len) { s += ALPHA[c1]; break; }
                c2 = b[i++];
                s += ALPHA[c1 | (c2 >> 6)] + ALPHA[c2 & 0x3f];
            }
            return s;
        }

        function parse(hash) {
            var m = /^\$(2[abxy]?)\$(\d{2})\$([./A-Za-z0-9]{22})([./A-Za-z0-9]{31})$/.exec(String(hash || '').trim());
            if (!m) return null;
            return { variant: m[1], cost: Number(m[2]), salt: b64decode(m[3], 16), sum: b64decode(m[4], 23), saltText: m[3] };
        }

        function utf8(s) {
            if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
            return new Uint8Array(Buffer.from(s, 'utf8'));
        }

        // Ett tillstånd per körning: P (18 ord) och S (4 × 256) i en tabell.
        function run(keyBytes, salt, cost) {
            var S = new Int32Array(INIT);
            var P = S.subarray(0, 18);
            var S0 = 18, S1 = 18 + 256, S2 = 18 + 512, S3 = 18 + 768;
            var lr = new Int32Array(2);
            function enc() {
                var l = lr[0] ^ P[0], r = lr[1];
                for (var i = 1; i <= 16; i += 2) {
                    r ^= (((S[S0 + (l >>> 24)] + S[S1 + ((l >>> 16) & 255)]) ^ S[S2 + ((l >>> 8) & 255)]) + S[S3 + (l & 255)]) ^ P[i];
                    l ^= (((S[S0 + (r >>> 24)] + S[S1 + ((r >>> 16) & 255)]) ^ S[S2 + ((r >>> 8) & 255)]) + S[S3 + (r & 255)]) ^ P[i + 1];
                }
                lr[0] = r ^ P[17];
                lr[1] = l;
            }
            // Orden ur en bytefölj, runt i ring som i OpenBSD (stream2word).
            function words(bytes) {
                var n = bytes.length, pos = 0;
                return function () {
                    var w = 0;
                    for (var k = 0; k < 4; k++) { w = (w << 8) | bytes[pos]; pos = (pos + 1) % n; }
                    return w | 0;
                };
            }
            function expand(key, withSalt) {
                var kw = words(key), sw = withSalt ? words(salt) : null, i;
                for (i = 0; i < 18; i++) P[i] ^= kw();
                lr[0] = 0; lr[1] = 0;
                for (i = 0; i < 1042; i += 2) {
                    if (sw) { lr[0] ^= sw(); lr[1] ^= sw(); }
                    enc();
                    S[i] = lr[0];
                    S[i + 1] = lr[1];
                }
            }
            expand(keyBytes, true);
            var rounds = Math.pow(2, cost);
            for (var r = 0; r < rounds; r++) { expand(keyBytes, false); expand(salt, false); }
            var c = new Int32Array(6), mw = words(utf8(MAGIC));
            for (var k = 0; k < 6; k++) c[k] = mw();
            for (var t = 0; t < 64; t++) {
                for (var j = 0; j < 6; j += 2) { lr[0] = c[j]; lr[1] = c[j + 1]; enc(); c[j] = lr[0]; c[j + 1] = lr[1]; }
            }
            var out = new Uint8Array(24);
            for (var q = 0; q < 6; q++) { out[q * 4] = c[q] >>> 24; out[q * 4 + 1] = (c[q] >>> 16) & 255; out[q * 4 + 2] = (c[q] >>> 8) & 255; out[q * 4 + 3] = c[q] & 255; }
            return out;
        }

        // Koden som nyckel: UTF-8 med en nolla sist, högst 72 byte ($2a$ och $2b$ räknar så för koder under 72 byte).
        function keyOf(code) {
            var b = utf8(String(code));
            var k = new Uint8Array(Math.min(72, b.length + 1));
            k.set(b.subarray(0, Math.min(b.length, 72)));
            return k;
        }

        function sumOf(code, salt, cost) { return run(keyOf(code), salt, cost); }

        function hash(code, salt, cost) {
            var c = cost < 10 ? '0' + cost : String(cost);
            return '$2a$' + c + '$' + b64encode(salt, 16) + b64encode(sumOf(code, salt, cost), 23);
        }

        function same(a, b) { for (var i = 0; i < 23; i++) if (a[i] !== b[i]) return false; return true; }

        function check(code, h) {
            var p = typeof h === 'string' ? parse(h) : h;
            return !!p && same(sumOf(code, p.salt, p.cost), p.sum);
        }

        return { parse: parse, hash: hash, check: check, b64encode: b64encode, b64decode: b64decode };
    }

    var api = make();

    // Många koder i flera trådar. Varje tråd prövar en del av listan och säger till var 50:e kod. Utan Worker (Node,
    // eller där trådar inte går att skapa) prövas koderna i den här tråden i små omgångar.
    api.crack = function (h, codes, opts) {
        opts = opts || {};
        var p = api.parse(h);
        if (!p) return Promise.reject(new Error('Hashen är ingen bcrypt-hash.'));
        var list = Array.prototype.slice.call(codes || []);
        var total = list.length;
        var progress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
        var canWork = typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined';
        if (!canWork || opts.workers === 0) {
            return new Promise(function (resolve) {
                var i = 0;
                (function step() {
                    var end = Math.min(total, i + 20);
                    for (; i < end; i++) if (api.check(list[i], p)) { progress(i + 1, total); resolve(list[i]); return; }
                    progress(i, total);
                    if (i >= total || (opts.signal && opts.signal.aborted)) { resolve(null); return; }
                    setTimeout(step, 0);
                })();
            });
        }
        var n = Math.max(1, Math.min(opts.workers || ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 1, 16));
        var src = 'var B = (' + make.toString() + ')();\n' +
            'onmessage = function (e) { var d = e.data, p = B.parse(d.hash), done = 0;\n' +
            '  for (var i = 0; i < d.codes.length; i++) {\n' +
            '    if (B.check(d.codes[i], p)) { postMessage({ hit: d.codes[i], done: done + 1 }); return; }\n' +
            '    if (++done % 50 === 0) postMessage({ done: 50 });\n' +
            '  }\n' +
            '  postMessage({ end: true, done: done % 50 }); };';
        var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        return new Promise(function (resolve) {
            var workers = [], tried = 0, ended = 0, over = false;
            var finish = function (code) {
                if (over) return;
                over = true;
                workers.forEach(function (w) { w.terminate(); });
                URL.revokeObjectURL(url);
                resolve(code);
            };
            if (opts.signal) opts.signal.addEventListener('abort', function () { finish(null); });
            for (var k = 0; k < n; k++) {
                var part = list.filter(function (_, i) { return i % n === k; });
                var w = new Worker(url);
                w.onmessage = function (e) {
                    var d = e.data;
                    tried += d.done || 0;
                    progress(Math.min(tried, total), total);
                    if (d.hit !== undefined) finish(d.hit);
                    else if (d.end && ++ended === n) finish(null);
                };
                w.onerror = function () { if (++ended === n) finish(null); };
                workers.push(w);
                w.postMessage({ hash: h, codes: part });
            }
        });
    };

    // Alla koder med fyra siffror, 0000–9999. De vanligaste först (år, upprepade och i följd), så att en vanlig kod hittas tidigt.
    api.fourDigits = function () {
        var first = [], seen = {}, all = [];
        var add = function (c) { if (!seen[c]) { seen[c] = true; first.push(c); } };
        for (var d = 0; d < 10; d++) add(String(d).repeat(4));
        ['1234', '4321', '0123', '1212', '1122', '6969', '1004', '2000', '2580'].forEach(add);
        for (var y = 2030; y >= 1950; y--) add(String(y));
        for (var i = 0; i < 10000; i++) { var s = String(i).padStart(4, '0'); if (!seen[s]) all.push(s); }
        return first.concat(all);
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Bcrypt = api;
})(typeof window !== 'undefined' ? window : this);
