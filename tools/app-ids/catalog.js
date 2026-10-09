// Kuraterad katalog. iOS bundle-id är lästa ur iTunes lookup
// (https://itunes.apple.com/lookup?id=TRACK&country=se) för det App Store-id
// som sökningen gav. Android är butikspaketet. Forkar kan avvika.
(function (root) {
    'use strict';

    var GROUPS = [
        { id: 'chatt', label: 'Chatt' },
        { id: 'socialt', label: 'Socialt' },
        { id: 'dejting', label: 'Dejting' },
        { id: 'krypto', label: 'Krypto' },
        { id: 'betalning', label: 'Betalning' },
        { id: 'sverige', label: 'Sverige' },
        { id: 'webbläsare', label: 'Webbläsare' },
        { id: 'epost', label: 'E-post' },
        { id: 'system', label: 'Förinstallerat iOS' },
    ];

    function app(entry) {
        var ios = entry.ios || null;
        var android = entry.android || null;
        return {
            id: entry.id,
            name: entry.name,
            category: entry.category,
            aliases: entry.aliases || [],
            android: android,
            ios: ios,
            playUrl: android ? 'https://play.google.com/store/apps/details?id=' + android : '',
            appStoreUrl: ios && ios.trackId ? 'https://apps.apple.com/se/app/id' + ios.trackId : '',
        };
    }

    var APPS = [
        app({ id: 'signal', name: 'Signal', category: 'chatt', aliases: ['privata meddelanden'], android: 'org.thoughtcrime.securesms', ios: { bundleId: 'org.whispersystems.signal', trackId: 874139669 } }),
        app({ id: 'whatsapp', name: 'WhatsApp', category: 'chatt', aliases: ['wa'], android: 'com.whatsapp', ios: { bundleId: 'net.whatsapp.WhatsApp', trackId: 310633997 } }),
        app({ id: 'whatsapp-business', name: 'WhatsApp Business', category: 'chatt', android: 'com.whatsapp.w4b', ios: { bundleId: 'net.whatsapp.WhatsAppSMB', trackId: 1386412985 } }),
        app({ id: 'telegram', name: 'Telegram', category: 'chatt', android: 'org.telegram.messenger', ios: { bundleId: 'ph.telegra.Telegraph', trackId: 686449807 } }),
        app({ id: 'telegram-x', name: 'Telegram X', category: 'chatt', android: 'org.thunderdog.challegram' }),
        app({ id: 'messenger', name: 'Messenger', category: 'chatt', aliases: ['facebook messenger', 'fb'], android: 'com.facebook.orca', ios: { bundleId: 'com.facebook.Messenger', trackId: 454638411 } }),
        app({ id: 'instagram', name: 'Instagram', category: 'chatt', aliases: ['ig'], android: 'com.instagram.android', ios: { bundleId: 'com.burbn.instagram', trackId: 389801252 } }),
        app({ id: 'snapchat', name: 'Snapchat', category: 'chatt', android: 'com.snapchat.android', ios: { bundleId: 'com.toyopagroup.picaboo', trackId: 447188370 } }),
        app({ id: 'discord', name: 'Discord', category: 'chatt', android: 'com.discord', ios: { bundleId: 'com.hammerandchisel.discord', trackId: 985746746 } }),
        app({ id: 'viber', name: 'Viber', category: 'chatt', android: 'com.viber.voip', ios: { bundleId: 'com.viber', trackId: 382617920 } }),
        app({ id: 'line', name: 'LINE', category: 'chatt', android: 'jp.naver.line.android', ios: { bundleId: 'jp.naver.line', trackId: 443904275 } }),
        app({ id: 'wechat', name: 'WeChat', category: 'chatt', android: 'com.tencent.mm', ios: { bundleId: 'com.tencent.xin', trackId: 414478124 } }),
        app({ id: 'kakaotalk', name: 'KakaoTalk', category: 'chatt', android: 'com.kakao.talk', ios: { bundleId: 'com.iwilab.KakaoTalk', trackId: 362057947 } }),
        app({ id: 'threema', name: 'Threema', category: 'chatt', android: 'ch.threema.app', ios: { bundleId: 'ch.threema.iapp', trackId: 578665578 } }),
        app({ id: 'session', name: 'Session', category: 'chatt', android: 'network.loki.messenger', ios: { bundleId: 'com.loki-project.loki-messenger', trackId: 1470168868 } }),
        app({ id: 'wire', name: 'Wire', category: 'chatt', android: 'com.wire', ios: { bundleId: 'com.wearezeta.zclient.ios', trackId: 930944768 } }),
        app({ id: 'element', name: 'Element', category: 'chatt', aliases: ['element classic', 'matrix'], android: 'im.vector.app', ios: { bundleId: 'im.vector.app', trackId: 1083446067 } }),
        app({ id: 'element-x', name: 'Element X', category: 'chatt', aliases: ['matrix'], android: 'io.element.android.x', ios: { bundleId: 'io.element.elementx', trackId: 1631335820 } }),
        app({ id: 'imo', name: 'imo', category: 'chatt', android: 'com.imo.android.imoim', ios: { bundleId: 'imoimiphone', trackId: 336435697 } }),
        app({ id: 'kik', name: 'Kik', category: 'chatt', android: 'kik.android', ios: { bundleId: 'com.kik.chat', trackId: 357218860 } }),
        app({ id: 'botim', name: 'BOTIM', category: 'chatt', android: 'im.thebot.messenger', ios: { bundleId: 'im.thebot', trackId: 1263036818 } }),
        app({ id: 'groupme', name: 'GroupMe', category: 'chatt', android: 'com.groupme.android', ios: { bundleId: 'com.groupme.iphone-app', trackId: 392796698 } }),
        app({ id: 'teams', name: 'Microsoft Teams', category: 'chatt', aliases: ['teams'], android: 'com.microsoft.teams', ios: { bundleId: 'com.microsoft.skype.teams', trackId: 1113153706 } }),
        app({ id: 'slack', name: 'Slack', category: 'chatt', android: 'com.Slack', ios: { bundleId: 'com.tinyspeck.chatlyio', trackId: 618783545 } }),
        app({ id: 'zoom', name: 'Zoom', category: 'chatt', android: 'us.zoom.videomeetings', ios: { bundleId: 'us.zoom.videomeetings', trackId: 546505307 } }),
        app({ id: 'google-chat', name: 'Google Chat', category: 'chatt', android: 'com.google.android.apps.dynamite', ios: { bundleId: 'com.google.Dynamite', trackId: 1163852619 } }),
        app({ id: 'dust', name: 'Dust', category: 'chatt', aliases: ['cyberdust'], ios: { bundleId: 'com.mentionmobile.cyberdust', trackId: 690158616 } }),
        app({ id: 'olvid', name: 'Olvid', category: 'chatt', android: 'io.olvid.messenger', ios: { bundleId: 'io.olvid.messenger', trackId: 1414865219 } }),
        app({ id: 'simplex', name: 'SimpleX', category: 'chatt', android: 'chat.simplex.app', ios: { bundleId: 'chat.simplex.app', trackId: 1605771084 } }),
        app({ id: 'wickr', name: 'AWS Wickr', category: 'chatt', aliases: ['wickr'], ios: { bundleId: 'com.wickr.pro.prod', trackId: 1200926568 } }),
        app({ id: 'skype', name: 'Skype', category: 'chatt', android: 'com.skype.raider' }),
        app({ id: 'textnow', name: 'TextNow', category: 'chatt', android: 'com.enflick.android.TextNow' }),
        app({ id: 'google-messages', name: 'Google Messages', category: 'chatt', android: 'com.google.android.apps.messaging' }),
        app({ id: 'samsung-messages', name: 'Samsung Messages', category: 'chatt', android: 'com.samsung.android.messaging' }),
        app({ id: 'briar', name: 'Briar', category: 'chatt', android: 'org.briarproject.briar' }),
        app({ id: 'delta-chat', name: 'Delta Chat', category: 'chatt', android: 'chat.delta', ios: { bundleId: 'chat.delta', trackId: 1459523234 } }),
        app({ id: 'jami', name: 'Jami', category: 'chatt', android: 'cx.ring', ios: { bundleId: 'com.savoirfairelinux.ring', trackId: 1306951055 } }),
        app({ id: 'keybase', name: 'Keybase', category: 'chatt', android: 'io.keybase.ossifrage', ios: { bundleId: 'keybase.ios', trackId: 1044461770 } }),
        app({ id: 'berty', name: 'Berty', category: 'chatt', android: 'tech.berty.android', ios: { bundleId: 'tech.berty.ios', trackId: 1535500412 } }),
        app({ id: 'threema-work', name: 'Threema Work', category: 'chatt', android: 'ch.threema.app.work', ios: { bundleId: 'ch.threema.work.iapp', trackId: 1105927783 } }),
        app({ id: 'status', name: 'Status', category: 'chatt', aliases: ['status.im'], android: 'im.status.ethereum', ios: { bundleId: 'app.status.mobile', trackId: 6754166924 } }),
        app({ id: 'molly', name: 'Molly', category: 'chatt', aliases: ['signal fork'], android: 'im.molly.app' }),
        app({ id: 'imessage', name: 'Meddelanden', category: 'system', aliases: ['imessage', 'sms', 'apple messages'], ios: { bundleId: 'com.apple.MobileSMS' } }),

        app({ id: 'tiktok', name: 'TikTok', category: 'socialt', android: 'com.zhiliaoapp.musically', ios: { bundleId: 'com.zhiliaoapp.musically', trackId: 835599320 } }),
        app({ id: 'x', name: 'X', category: 'socialt', aliases: ['twitter'], android: 'com.twitter.android', ios: { bundleId: 'com.atebits.Tweetie2', trackId: 333903271 } }),
        app({ id: 'facebook', name: 'Facebook', category: 'socialt', android: 'com.facebook.katana', ios: { bundleId: 'com.facebook.Facebook', trackId: 284882215 } }),
        app({ id: 'reddit', name: 'Reddit', category: 'socialt', android: 'com.reddit.frontpage', ios: { bundleId: 'com.reddit.Reddit', trackId: 1064216828 } }),
        app({ id: 'linkedin', name: 'LinkedIn', category: 'socialt', android: 'com.linkedin.android', ios: { bundleId: 'com.linkedin.LinkedIn', trackId: 288429040 } }),
        app({ id: 'threads', name: 'Threads', category: 'socialt', android: 'com.instagram.barcelona', ios: { bundleId: 'com.burbn.barcelona', trackId: 6446901002 } }),
        app({ id: 'bereal', name: 'BeReal', category: 'socialt', android: 'com.bereal.ft', ios: { bundleId: 'AlexisBarreyat.BeReal', trackId: 1459645446 } }),

        app({ id: 'tinder', name: 'Tinder', category: 'dejting', android: 'com.tinder', ios: { bundleId: 'com.cardify.tinder', trackId: 547702041 } }),
        app({ id: 'bumble', name: 'Bumble', category: 'dejting', android: 'com.bumble.app', ios: { bundleId: 'com.moxco.bumble', trackId: 930441707 } }),
        app({ id: 'hinge', name: 'Hinge', category: 'dejting', android: 'co.hinge.app', ios: { bundleId: 'co.hinge.mobile.ios', trackId: 595287172 } }),
        app({ id: 'grindr', name: 'Grindr', category: 'dejting', android: 'com.grindrapp.android', ios: { bundleId: 'com.grindrguy.grindrx', trackId: 319881193 } }),

        app({ id: 'trust', name: 'Trust Wallet', category: 'krypto', android: 'com.wallet.crypto.trustapp', ios: { bundleId: 'com.sixdays.trust', trackId: 1288339409 } }),
        app({ id: 'metamask', name: 'MetaMask', category: 'krypto', android: 'io.metamask', ios: { bundleId: 'io.metamask.MetaMask', trackId: 1438144202 } }),
        app({ id: 'coinbase', name: 'Coinbase', category: 'krypto', android: 'com.coinbase.android', ios: { bundleId: 'com.vilcsak.bitcoin2', trackId: 886427730 } }),
        app({ id: 'coinbase-wallet', name: 'Coinbase Wallet', category: 'krypto', aliases: ['toshi'], android: 'org.toshi', ios: { bundleId: 'org.toshi.distribution', trackId: 1278383455 } }),
        app({ id: 'binance', name: 'Binance', category: 'krypto', android: 'com.binance.dev', ios: { bundleId: 'com.czzhao.binance', trackId: 1436799971 } }),
        app({ id: 'exodus', name: 'Exodus', category: 'krypto', android: 'exodusmovement.exodus', ios: { bundleId: 'exodus-movement.exodus', trackId: 1414384820 } }),
        app({ id: 'blockchain', name: 'Blockchain.com', category: 'krypto', android: 'piuk.blockchain.android', ios: { bundleId: 'com.rainydayapps.Blockchain', trackId: 493253309 } }),
        app({ id: 'bluewallet', name: 'BlueWallet', category: 'krypto', android: 'io.bluewallet.bluewallet', ios: { bundleId: 'io.bluewallet.bluewallet', trackId: 1376878040 } }),
        app({ id: 'phoenix', name: 'Phoenix', category: 'krypto', aliases: ['lightning'], android: 'fr.acinq.phoenix.mainnet', ios: { bundleId: 'co.acinq.phoenix', trackId: 1544097028 } }),
        app({ id: 'muun', name: 'Muun', category: 'krypto', android: 'io.muun.apollo', ios: { bundleId: 'com.muun.falcon', trackId: 1482037683 } }),
        app({ id: 'phantom', name: 'Phantom', category: 'krypto', aliases: ['solana'], android: 'app.phantom', ios: { bundleId: 'app.phantom', trackId: 1598432977 } }),
        app({ id: 'ledger', name: 'Ledger Live', category: 'krypto', android: 'com.ledger.live', ios: { bundleId: 'com.ledger.live', trackId: 1361671700 } }),
        app({ id: 'crypto-com', name: 'Crypto.com', category: 'krypto', android: 'co.mona.android', ios: { bundleId: 'co.mona.Monaco', trackId: 1262148500 } }),
        app({ id: 'kraken', name: 'Kraken', category: 'krypto', android: 'com.kraken.invest.app', ios: { bundleId: 'com.kraken.invest.app', trackId: 1481947260 } }),
        app({ id: 'okx', name: 'OKX', category: 'krypto', android: 'com.okinc.okex.gp', ios: { bundleId: 'com.okex.OKExAppstoreFull', trackId: 1327268470 } }),
        app({ id: 'kucoin', name: 'KuCoin', category: 'krypto', android: 'com.kubi.kucoin', ios: { bundleId: 'com.kucoin.KuCoin.iOS', trackId: 1378956601 } }),
        app({ id: 'etoro', name: 'eToro', category: 'krypto', android: 'com.etoro.openbook', ios: { bundleId: 'com.etoro.openbook', trackId: 674984916 } }),
        app({ id: 'strike', name: 'Strike', category: 'krypto', android: 'com.strike.strike', ios: { bundleId: 'com.jackmallers.Strike', trackId: 1488724463 } }),
        app({ id: 'relai', name: 'Relai', category: 'krypto', android: 'ch.relai.relai', ios: { bundleId: 'ch.relai.relai', trackId: 1513185997 } }),
        app({ id: 'rainbow', name: 'Rainbow', category: 'krypto', android: 'me.rainbow', ios: { bundleId: 'me.rainbow', trackId: 1457119021 } }),
        app({ id: 'unstoppable', name: 'Unstoppable', category: 'krypto', android: 'io.horizontalsystems.bankwallet', ios: { bundleId: 'io.horizontalsystems.bank-wallet', trackId: 1447619907 } }),
        app({ id: 'trezor', name: 'Trezor Suite', category: 'krypto', android: 'io.trezor.suite', ios: { bundleId: 'io.trezor.suite', trackId: 1631884497 } }),
        app({ id: 'oneinch', name: '1inch', category: 'krypto', android: 'io.oneinch.android', ios: { bundleId: 'exchange.1inch.ios', trackId: 1546049391 } }),
        app({ id: 'uniswap', name: 'Uniswap', category: 'krypto', android: 'com.uniswap.mobile', ios: { bundleId: 'com.uniswap.mobile', trackId: 6443944476 } }),
        app({ id: 'solflare', name: 'Solflare', category: 'krypto', android: 'com.solflare.mobile', ios: { bundleId: 'com.solflare.mobile', trackId: 1580902717 } }),
        app({ id: 'argent', name: 'Argent', category: 'krypto', android: 'im.argent.contractwalletclient', ios: { bundleId: 'xyz.argent.vault', trackId: 6746411858 } }),
        app({ id: 'zerion', name: 'Zerion', category: 'krypto', android: 'io.zerion.android', ios: { bundleId: 'com.dpfbop.zerion', trackId: 1456732565 } }),
        app({ id: 'cake', name: 'Cake Wallet', category: 'krypto', android: 'com.cakewallet.cake_wallet', ios: { bundleId: 'com.fotolockr.cakewallet', trackId: 1334702542 } }),
        app({ id: 'zeus', name: 'ZEUS', category: 'krypto', aliases: ['lightning'], android: 'app.zeusln.zeus', ios: { bundleId: 'com.zeusln.zeus', trackId: 1456038895 } }),
        app({ id: 'wos', name: 'Wallet of Satoshi', category: 'krypto', android: 'com.livingroomofsatoshi.wallet', ios: { bundleId: 'com.livingroomofsatoshi.wallet', trackId: 1438599608 } }),
        app({ id: 'bitpay', name: 'BitPay', category: 'krypto', android: 'com.bitpay.wallet', ios: { bundleId: 'com.bitpay.wallet', trackId: 1149581638 } }),
        app({ id: 'imtoken', name: 'imToken', category: 'krypto', android: 'im.token.app', ios: { bundleId: 'im.token.app', trackId: 1384798940 } }),
        app({ id: 'electrum', name: 'Electrum', category: 'krypto', android: 'org.electrum.electrum' }),
        app({ id: 'mycelium', name: 'Mycelium', category: 'krypto', android: 'com.mycelium.wallet' }),
        app({ id: 'safepal', name: 'SafePal', category: 'krypto', android: 'io.safepal.wallet', ios: { bundleId: 'walletapp.safepal.io', trackId: 1548297139 } }),
        app({ id: 'atomic', name: 'Atomic Wallet', category: 'krypto', android: 'io.atomicwallet', ios: { bundleId: 'atomicwallet', trackId: 1478257827 } }),
        app({ id: 'robinhood', name: 'Robinhood', category: 'krypto', android: 'com.robinhood.android', ios: { bundleId: 'com.robinhood.release.RobinhoodGlobal', trackId: 6467049008 } }),
        app({ id: 'gemini', name: 'Gemini', category: 'krypto', android: 'com.gemini.android', ios: { bundleId: 'com.gemini.ios', trackId: 1408914447 } }),
        app({ id: 'bybit', name: 'Bybit', category: 'krypto', android: 'com.bybit.app', ios: { bundleId: 'com.bybit.app', trackId: 1488296980 } }),
        app({ id: 'bitget', name: 'Bitget', category: 'krypto', android: 'com.bitget.exchange', ios: { bundleId: 'com.bitget.exchange.global', trackId: 1442778704 } }),
        app({ id: 'green', name: 'Blockstream Green', category: 'krypto', aliases: ['green wallet'], android: 'com.blockstream.green', ios: { bundleId: 'io.blockstream.green', trackId: 1402243590 } }),
        app({ id: 'bitcoin-com', name: 'Bitcoin.com Wallet', category: 'krypto', android: 'com.bitcoin.mwallet', ios: { bundleId: 'com.bitcoin.mwallet', trackId: 1252903728 } }),
        app({ id: 'guarda', name: 'Guarda', category: 'krypto', android: 'com.crypto.multiwallet', ios: { bundleId: 'com.crypto.multiwallet', trackId: 1442083982 } }),
        app({ id: 'tokenpocket', name: 'TokenPocket', category: 'krypto', android: 'vip.mytokenpocket', ios: { bundleId: 'com.global.wallet.ios', trackId: 6444625622 } }),
        app({ id: 'onekey', name: 'OneKey', category: 'krypto', android: 'so.onekey.app.wallet', ios: { bundleId: 'so.onekey.wallet', trackId: 1609559473 } }),
        app({ id: 'rabby', name: 'Rabby', category: 'krypto', android: 'com.debank.rabbymobile', ios: { bundleId: 'com.debank.rabby-mobile', trackId: 6474381673 } }),
        app({ id: 'bitpanda', name: 'Bitpanda', category: 'krypto', android: 'com.bitpanda.bitpanda', ios: { bundleId: 'com.bitpanda.bitpanda', trackId: 1449018960 } }),
        app({ id: 'swissborg', name: 'SwissBorg', category: 'krypto', android: 'com.swissborg.swissborg', ios: { bundleId: 'com.swissborg.ios', trackId: 1442483481 } }),
        app({ id: 'wirex', name: 'Wirex', category: 'krypto', android: 'com.wirex', ios: { bundleId: 'com.wirexapp.one', trackId: 6762381032 } }),
        app({ id: 'aqua', name: 'AQUA', category: 'krypto', android: 'io.aquawallet.android', ios: { bundleId: 'io.aquawallet.ios', trackId: 6468594241 } }),
        app({ id: 'zengo', name: 'Zengo', category: 'krypto', android: 'com.zengo.wallet', ios: { bundleId: 'kzencorp.mobile.ios', trackId: 1440147115 } }),
        app({ id: 'glow', name: 'Glow', category: 'krypto', aliases: ['breez', 'lightning'], ios: { bundleId: 'technology.breez.glow', trackId: 6762465698 } }),

        app({ id: 'cash-app', name: 'Cash App', category: 'betalning', android: 'com.squareup.cash', ios: { bundleId: 'com.squareup.cash', trackId: 711923939 } }),
        app({ id: 'paypal', name: 'PayPal', category: 'betalning', android: 'com.paypal.android.p2pmobile', ios: { bundleId: 'com.yourcompany.PPClient', trackId: 283646709 } }),
        app({ id: 'venmo', name: 'Venmo', category: 'betalning', android: 'com.venmo', ios: { bundleId: 'net.kortina.labs.Venmo', trackId: 351727428 } }),
        app({ id: 'revolut', name: 'Revolut', category: 'betalning', android: 'com.revolut.revolut', ios: { bundleId: 'com.revolut.revolut', trackId: 932493382 } }),
        app({ id: 'n26', name: 'N26', category: 'betalning', android: 'de.number26.android', ios: { bundleId: 'de.no26.Number26', trackId: 956857223 } }),
        app({ id: 'wise', name: 'Wise', category: 'betalning', aliases: ['transferwise'], android: 'com.transferwise.android', ios: { bundleId: 'com.transferwise.Transferwise', trackId: 612261027 } }),
        app({ id: 'swish', name: 'Swish', category: 'betalning', android: 'se.bankgirot.swish', ios: { bundleId: 'se.bankgirot.swish', trackId: 563204724 } }),
        app({ id: 'bankid', name: 'BankID', category: 'betalning', android: 'com.bankid.bus', ios: { bundleId: 'com.bankidapp.BankID', trackId: 433151512 } }),
        app({ id: 'klarna', name: 'Klarna', category: 'betalning', android: 'com.myklarnamobile', ios: { bundleId: 'com.klarna.app', trackId: 1115120118 } }),
        app({ id: 'vipps', name: 'Vipps', category: 'betalning', android: 'no.dnb.vipps.mw', ios: { bundleId: 'no.dnb.vipps', trackId: 984380185 } }),
        app({ id: 'mobilepay', name: 'MobilePay', category: 'betalning', android: 'com.danskebank.mobilepay', ios: { bundleId: 'com.danskebank.mobilepay', trackId: 624499138 } }),

        app({ id: 'avanza', name: 'Avanza', category: 'sverige', android: 'se.avanza.android', ios: { bundleId: 'se.avanza.iphone', trackId: 381311572 } }),
        app({ id: 'nordnet', name: 'Nordnet', category: 'sverige', android: 'com.nordnet.android', ios: { bundleId: 'com.nordnet.Nordnet', trackId: 345038631 } }),
        app({ id: 'swedbank', name: 'Swedbank', category: 'sverige', android: 'se.swedbank.mobil', ios: { bundleId: 'se.swedbank.iphonebanken', trackId: 344161302 } }),
        app({ id: 'seb', name: 'SEB', category: 'sverige', android: 'se.seb.android', ios: { bundleId: 'se.seb.privatkund', trackId: 366674595 } }),
        app({ id: 'handelsbanken', name: 'Handelsbanken', category: 'sverige', android: 'se.handelsbanken.mobilbank', ios: { bundleId: 'se.handelsbanken.TelesvarIBilder', trackId: 378393286 } }),
        app({ id: 'nordea', name: 'Nordea', category: 'sverige', android: 'com.nordea.mobilebank', ios: { bundleId: 'com.nordea.mobilebank.se', trackId: 571239441 } }),
        app({ id: 'danske', name: 'Danske Bank', category: 'sverige', android: 'com.danskebank.mobilebank3.se', ios: { bundleId: 'com.danskebank.mobilebank3se', trackId: 1315948868 } }),
        app({ id: 'lansforsakringar', name: 'Länsförsäkringar', category: 'sverige', android: 'se.lansforsakringar.android', ios: { bundleId: 'se.lansforsakringar.mobil', trackId: 426706646 } }),
        app({ id: 'sbab', name: 'SBAB', category: 'sverige', android: 'se.sbab.android', ios: { bundleId: 'se.sbab.bankapp', trackId: 1284703331 } }),
        app({ id: 'skandia', name: 'Skandia', category: 'sverige', aliases: ['skandiabanken'], android: 'se.skandiabanken.android', ios: { bundleId: 'se.skandia.skandia', trackId: 376991788 } }),
        app({ id: 'ica-banken', name: 'ICA Banken', category: 'sverige', android: 'se.icabanken.android', ios: { bundleId: 'se.icabanken.iphoneapp', trackId: 499287475 } }),
        app({ id: 'qliro', name: 'Qliro', category: 'sverige', ios: { bundleId: 'com.qliro.qliro', trackId: 1165368803 } }),
        app({ id: 'lunar', name: 'Lunar', category: 'sverige', android: 'com.lunarway.android', ios: { bundleId: 'com.lunarway', trackId: 1068850213 } }),
        app({ id: 'kivra', name: 'Kivra', category: 'sverige', android: 'com.kivra.kivra', ios: { bundleId: 'com.kivra.Kivra', trackId: 588705123 } }),
        app({ id: 'fk', name: 'Försäkringskassan', category: 'sverige', android: 'se.forsakringskassan.android', ios: { bundleId: 'se.forsakringskassan.fk', trackId: 554101146 } }),
        app({ id: '1177', name: '1177', category: 'sverige', android: 'se.inera.invanare', ios: { bundleId: 'se.inera.InvanarApp1177', trackId: 1441948105 } }),
        app({ id: 'kry', name: 'Kry', category: 'sverige', android: 'se.kry.android', ios: { bundleId: 'se.kry.prototype', trackId: 968052278 } }),
        app({ id: 'min-doktor', name: 'Min Doktor', category: 'sverige', android: 'se.mindoktor.android', ios: { bundleId: 'se.mindoktor.app.Min-Doktor', trackId: 1104213750 } }),
        app({ id: 'postnord', name: 'PostNord', category: 'sverige', android: 'se.postnord.private', ios: { bundleId: 'se.posten.SparaForsandelse', trackId: 396871673 } }),
        app({ id: 'blocket', name: 'Blocket', category: 'sverige', android: 'se.blocket.blocket', ios: { bundleId: 'com.blocket.blocket', trackId: 323710525 } }),
        app({ id: 'hemnet', name: 'Hemnet', category: 'sverige', android: 'com.hemnet.android', ios: { bundleId: 'com.Hemnet', trackId: 525017304 } }),
        app({ id: 'sj', name: 'SJ', category: 'sverige', android: 'se.sj.android', ios: { bundleId: 'se.sj.mobil.minresa', trackId: 442994825 } }),
        app({ id: 'fortnox', name: 'Fortnox', category: 'sverige', ios: { bundleId: 'se.fortnox.powerup.prod', trackId: 1350403648 } }),

        app({ id: 'chrome', name: 'Chrome', category: 'webbläsare', android: 'com.android.chrome', ios: { bundleId: 'com.google.chrome.ios', trackId: 535886823 } }),
        app({ id: 'firefox', name: 'Firefox', category: 'webbläsare', android: 'org.mozilla.firefox', ios: { bundleId: 'org.mozilla.ios.Firefox', trackId: 989804926 } }),
        app({ id: 'brave', name: 'Brave', category: 'webbläsare', android: 'com.brave.browser', ios: { bundleId: 'com.brave.ios.browser', trackId: 1052879175 } }),
        app({ id: 'edge', name: 'Edge', category: 'webbläsare', android: 'com.microsoft.emmx', ios: { bundleId: 'com.microsoft.msedge', trackId: 1288723196 } }),
        app({ id: 'opera', name: 'Opera', category: 'webbläsare', android: 'com.opera.browser', ios: { bundleId: 'com.opera.OperaTouch', trackId: 1411869974 } }),
        app({ id: 'duckduckgo', name: 'DuckDuckGo', category: 'webbläsare', android: 'com.duckduckgo.mobile.android', ios: { bundleId: 'com.duckduckgo.mobile.ios', trackId: 663592361 } }),
        app({ id: 'tor', name: 'Tor Browser', category: 'webbläsare', android: 'org.torproject.torbrowser' }),
        app({ id: 'safari', name: 'Safari', category: 'system', ios: { bundleId: 'com.apple.mobilesafari' } }),

        app({ id: 'proton', name: 'Proton Mail', category: 'epost', android: 'ch.protonmail.android', ios: { bundleId: 'ch.protonmail.protonmail', trackId: 979659905 } }),
        app({ id: 'tuta', name: 'Tuta', category: 'epost', aliases: ['tutanota'], android: 'de.tutao.tutanota', ios: { bundleId: 'de.tutao.tutanota', trackId: 922429609 } }),
        app({ id: 'gmail', name: 'Gmail', category: 'epost', android: 'com.google.android.gm', ios: { bundleId: 'com.google.Gmail', trackId: 422689480 } }),
        app({ id: 'outlook', name: 'Outlook', category: 'epost', android: 'com.microsoft.office.outlook', ios: { bundleId: 'com.microsoft.Office.Outlook', trackId: 951937596 } }),
        app({ id: 'apple-mail', name: 'Mail', category: 'system', aliases: ['apple mail'], ios: { bundleId: 'com.apple.mobilemail' } }),
        app({ id: 'facetime', name: 'FaceTime', category: 'system', ios: { bundleId: 'com.apple.facetime' } }),

        app({ id: 'conversations', name: 'Conversations', category: 'chatt', android: 'eu.siacs.conversations' }),
        app({ id: 'cheogram', name: 'Cheogram', category: 'chatt', android: 'com.cheogram.android' }),
        app({ id: 'fluffychat', name: 'FluffyChat', category: 'chatt', android: 'chat.fluffy.fluffychat', ios: { bundleId: 'im.fluffychat.app', trackId: 1551469600 } }),
        app({ id: 'schildichat', name: 'SchildiChat', category: 'chatt', android: 'de.spiritcroc.schildichat' }),
        app({ id: 'monal', name: 'Monal', category: 'chatt', ios: { bundleId: 'G7YU7X7KRJ.SworIM', trackId: 317711500 } }),
        app({ id: 'silence', name: 'Silence', category: 'chatt', android: 'org.smssecure.smssecure' }),
        app({ id: 'plus-messenger', name: 'Plus Messenger', category: 'chatt', android: 'org.telegram.plus' }),
        app({ id: 'nicegram', name: 'Nicegram', category: 'chatt', ios: { bundleId: 'app.nicegram', trackId: 1608870673 } }),
        app({ id: 'coverme', name: 'CoverMe', category: 'chatt', android: 'ws.coverme.im' }),
        app({ id: 'silent-phone', name: 'Silent Phone', category: 'chatt', android: 'com.silentcircle.silentphone', ios: { bundleId: 'com.silentcircle.SilentPhone', trackId: 554269204 } }),
        app({ id: 'keet', name: 'Keet', category: 'chatt', ios: { bundleId: 'io.keet.app', trackId: 6443880549 } }),

        app({ id: 'safello', name: 'Safello', category: 'krypto', ios: { bundleId: 'com.safello.iosapp', trackId: 1514429922 } }),
        app({ id: 'trijo', name: 'Trijo', category: 'krypto', ios: { bundleId: 'co.trijo.app', trackId: 6449711135 } }),
        app({ id: 'quickbit', name: 'QuickBit', category: 'krypto', ios: { bundleId: 'com.quickbit.app', trackId: 1557896029 } }),
        app({ id: 'bitstamp', name: 'Bitstamp', category: 'krypto', ios: { bundleId: 'net.bitstamp', trackId: 1406825640 } }),
        app({ id: 'gateio', name: 'Gate.io', category: 'krypto', ios: { bundleId: 'com.gateio.app.gateio-app', trackId: 1294998195 } }),
        app({ id: 'mexc', name: 'MEXC', category: 'krypto', ios: { bundleId: 'mobile.mexcglobal.www', trackId: 1605393003 } }),
        app({ id: 'bitvavo', name: 'Bitvavo', category: 'krypto', ios: { bundleId: 'com.bitvavo', trackId: 1483903423 } }),
        app({ id: 'uphold', name: 'Uphold', category: 'krypto', ios: { bundleId: 'com.uphold.wallet.ios', trackId: 1101145849 } }),
        app({ id: 'bitfinex', name: 'Bitfinex', category: 'krypto', ios: { bundleId: 'com.bitfinex.bfxprod', trackId: 1436383182 } }),
        app({ id: 'edge-wallet', name: 'Edge Wallet', category: 'krypto', ios: { bundleId: 'co.edgesecure.app', trackId: 1344400091 } }),
        app({ id: 'ellipal', name: 'ELLIPAL', category: 'krypto', ios: { bundleId: 'com.Ellipal.Ellipal', trackId: 1426179665 } }),
        app({ id: 'coolwallet', name: 'CoolWallet', category: 'krypto', ios: { bundleId: 'com.coolbitx.coolwallets', trackId: 1328764142 } }),
        app({ id: 'tangem', name: 'Tangem', category: 'krypto', ios: { bundleId: 'com.tangem.Tangem', trackId: 1354868448 } }),
        app({ id: 'keplr', name: 'Keplr', category: 'krypto', ios: { bundleId: 'com.chainapsis.keplrwallet', trackId: 1567851089 } }),
        app({ id: 'core-avax', name: 'Core Wallet', category: 'krypto', ios: { bundleId: 'org.avalabs.corewallet', trackId: 6443685999 } }),
        app({ id: 'temple', name: 'Temple', category: 'krypto', ios: { bundleId: 'com.madfish.temple-wallet', trackId: 1610108763 } }),
        app({ id: 'mathwallet', name: 'MathWallet', category: 'krypto', ios: { bundleId: 'com.mathglobal.mathwallet5', trackId: 1582612388 } }),
        app({ id: 'changelly', name: 'Changelly', category: 'krypto', ios: { bundleId: 'com.changelly.iosapp', trackId: 1435140380 } }),
        app({ id: 'moonpay', name: 'MoonPay', category: 'krypto', ios: { bundleId: 'com.moonpay.app', trackId: 1635031432 } }),
        app({ id: '21bitcoin', name: '21bitcoin', category: 'krypto', ios: { bundleId: 'digital.fior.21app', trackId: 1579302952 } }),
        app({ id: 'bitbox', name: 'BitBox', category: 'krypto', ios: { bundleId: 'swiss.bitbox.BitBoxApp', trackId: 6670479223 } }),
        app({ id: 'nuri', name: 'Nuri', category: 'krypto', ios: { bundleId: 'com.nuri.nuriwallet', trackId: 6754772131 } }),

        app({ id: 'csn', name: 'CSN', category: 'sverige', ios: { bundleId: 'se.csn.Mina-sidor', trackId: 694668133 } }),
        app({ id: 'sl', name: 'SL', category: 'sverige', ios: { bundleId: 'com.sl.SL-biljetter', trackId: 918418291 } }),
        app({ id: 'vasttrafik', name: 'Västtrafik', category: 'sverige', ios: { bundleId: 'com.vaesttrafik.vaesttrafik', trackId: 424903083 } }),
        app({ id: 'skanetrafiken', name: 'Skånetrafiken', category: 'sverige', ios: { bundleId: 'se.skanetrafiken.prod-washington-ios', trackId: 1180539331 } }),
        app({ id: 'foodora', name: 'Foodora', category: 'sverige', ios: { bundleId: 'se.onlinepizza.iPhone.OnlinePizza', trackId: 421369701 } }),
        app({ id: 'wolt', name: 'Wolt', category: 'sverige', ios: { bundleId: 'com.woltapp.wolt', trackId: 943905271 } }),
        app({ id: 'tradera', name: 'Tradera', category: 'sverige', ios: { bundleId: 'com.tradera.Tradera', trackId: 427984084 } }),
        app({ id: 'coop', name: 'Coop', category: 'sverige', ios: { bundleId: 'se.coop.coop', trackId: 408840395 } }),
        app({ id: 'systembolaget', name: 'Systembolaget', category: 'sverige', ios: { bundleId: 'com.systembolaget.systembolaget', trackId: 486802368 } }),
        app({ id: 'apoteket', name: 'Apoteket', category: 'sverige', ios: { bundleId: 'se.apoteket.Recept', trackId: 1053398061 } }),
        app({ id: 'doktor-se', name: 'Doktor.se', category: 'sverige', ios: { bundleId: 'se.doktor.clients-ios', trackId: 1193214096 } }),
        app({ id: 'doktor24', name: 'Doktor24', category: 'sverige', ios: { bundleId: 'se.alerisx.healy', trackId: 1249339459 } }),
        app({ id: 'folksam', name: 'Folksam', category: 'sverige', ios: { bundleId: 'com.folksam.FolksamApp', trackId: 6468263762 } }),
        app({ id: 'trygg-hansa', name: 'Trygg-Hansa ID Protect', category: 'sverige', ios: { bundleId: 'com.tryg.trygghansaidprotect', trackId: 1642475393 } }),
        app({ id: 'if-forsakring', name: 'If', category: 'sverige', ios: { bundleId: 'se.if.app', trackId: 1624689010 } }),
        app({ id: 'hedvig', name: 'Hedvig', category: 'sverige', ios: { bundleId: 'com.hedvig.app', trackId: 1303668531 } }),
        app({ id: 'freja', name: 'Freja eID', category: 'sverige', ios: { bundleId: 'com.verisec.Freja-eID', trackId: 1256552092 } }),
        app({ id: 'collector', name: 'Collector', category: 'sverige', ios: { bundleId: 'se.collector.creditcard', trackId: 1167398909 } }),
        app({ id: 'resurs', name: 'Resurs Bank', category: 'sverige', ios: { bundleId: 'com.resurs.rbapp', trackId: 1530346386 } }),
    ];

    function normalize(text) {
        return String(text || '').toLowerCase().trim();
    }

    function matches(entry, query) {
        var q = normalize(query);
        if (!q) return true;
        var ios = entry.ios || {};
        var hay = [entry.name, entry.category, entry.android, ios.bundleId, String(ios.trackId || '')]
            .concat(entry.aliases)
            .join(' ')
            .toLowerCase();
        return hay.indexOf(q) !== -1;
    }

    function filterApps(query, category) {
        return APPS.filter(function (entry) {
            if (category && entry.category !== category) return false;
            return matches(entry, query);
        });
    }

    function csvField(value) {
        var text = value == null ? '' : String(value);
        if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
        return text;
    }

    function groupLabel(category) {
        var group = GROUPS.filter(function (item) { return item.id === category; })[0];
        return group ? group.label : category;
    }

    // Synlig vy, en rad per app. ios_bundle_id och android_bundle_id är skilda kolumner.
    function toCsv(entries) {
        var lines = ['namn,typ,ios_bundle_id,android_bundle_id'];
        entries.forEach(function (entry) {
            lines.push([
                csvField(entry.name),
                csvField(groupLabel(entry.category)),
                csvField(entry.ios && entry.ios.bundleId),
                csvField(entry.android),
            ].join(','));
        });
        return lines.join('\r\n') + '\r\n';
    }

    var api = {
        GROUPS: GROUPS,
        APPS: APPS,
        filterApps: filterApps,
        matches: matches,
        toCsv: toCsv,
        groupLabel: groupLabel,
    };

    root.AppIds = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
