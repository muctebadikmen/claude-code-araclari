# Claude Code Araçları

Kendi işimde her gün kullandığım Claude Code modları. Kod yazmadan, Claude'a anlatarak yaptırdım; burada herkes için paylaşıyorum.

🎥 **Videoda nasıl çalıştıklarını gösterdim:** https://youtu.be/-B0hXhOzuUI
🏫 **Soru, destek ve yeni araçlar için ücretsiz Skool topluluğu:** https://www.skool.com/mustafa-dikmen-ile-yapay-zeka-1691/about

| Mod | Ne yapar |
|---|---|
| **otomatik-devir** | Sohbetin bağlamı dolmaya yaklaşınca Claude'a çalışan işleri bitirtir, yeni iş başlattırmaz, devam notu yazdırır ve işi yeni bir sohbette kaldığı yerden sürdürür. |
| **ilerleme-cubugu** | Süren işin ilerlemesini yazı kutusunun üstünde çubuk olarak gösterir: kaç adımın bittiği, yüzde kaç olduğu ve şu an hangi adımda olunduğu. |

> "Mod", Claude Code'un içine takılan küçük bir eklentidir. Claude Code'un görünüşünü ve davranışını değiştirir.

## Kurulum

**Gerekli:** Claude Code 2.1.287 veya üstü. Terminalde `claude --version` yazıp bakın; eskiyse `claude update`.

### Yol 1: Claude'a kurdurun (en kolayı)

Claude Code'u açın ve şu metni olduğu gibi yapıştırın. Komut çalıştırma izni isteyecek, onaylayın.

```
Şu 3 komutu sırayla çalıştır, başka hiçbir şey kurma veya değiştirme: (1) claude plugin marketplace add muctebadikmen/claude-code-araclari (2) claude plugin install otomatik-devir@muctebadikmen --scope user (3) claude plugin install ilerleme-cubugu@muctebadikmen --scope user. Sonunda claude plugin list çalıştır ve 2 modun da "enabled" olduğunu söyle. Hata olursa dur ve bana hatayı anlat.
```

### Yol 2: Terminalden

```bash
claude plugin marketplace add muctebadikmen/claude-code-araclari
claude plugin install otomatik-devir@muctebadikmen --scope user
claude plugin install ilerleme-cubugu@muctebadikmen --scope user
claude plugin list
```

`--scope user` "tüm projelerimde geçerli olsun" demektir. Listede ikisini de "enabled" görmelisiniz. Sonra Claude Code'da yeni bir sohbet açın ya da `/reload-plugins` yazın.

İsterseniz yalnız birini kurabilirsiniz; iki mod birbirinden bağımsız çalışır.

## Skill'ler: my-skills

Her gün kullandığım iş akışı skill'leri. Ana sohbet işi yönetir, alt ajanlar işi yapar; durum `.workflow/` klasöründe tutulur, böylece iş yeni bir sohbette kaldığı yerden sürer.

| Skill | Ne yapar |
|---|---|
| **my-skill-orchestrate** | Diğer tüm skill'lerin uyduğu kurallar: işi alt ajanlara dağıtır, `.workflow/STATE.md`'yi güncel tutar |
| **my-skill-init** | Projeyi başlatır: `STATE.md`, `AGENTS.md` kuralları, `.gitignore` |
| **my-skill-audit** | Koddaki gerçek sorunları bulur ve önem sırasına dizer |
| **my-skill-research** | Kodu ve web'i araştırıp tek bir öneri çıkarır |
| **my-skill-masterplan** | Doğrulanmış, paralel adımlara bölünmüş plan yazar |
| **my-skill-execute** | Planı alt ajanlarla uygular, her işi geri dönüşte kontrol eder |
| **my-skill-handoff** | İlerlemeyi dondurur, yeni sohbet için devam prompt'u yazar |
| **my-skill-ship** | Gizli bilgi taraması, doğrulama, commit ve push |

**Akışlar:** Hata için `audit → masterplan → execute → ship`. Yeni özellik için `research → masterplan → execute → ship`. `handoff` her an kullanılabilir.

Kurmak için:

```bash
claude plugin marketplace add muctebadikmen/claude-code-araclari
claude plugin install my-skills@muctebadikmen --scope user
```

Kullanmak için Claude'a doğrudan yazın: "projeyi başlat", "bu projeyi denetle", "şunu araştır", "bunun planını yap" gibi. Ya da `/my-skills:my-skill-audit` şeklinde çağırın.

## Güncelleme

Modları geliştirdikçe buraya yüklüyorum. Yeni sürümü almak için:

```bash
claude plugin marketplace update muctebadikmen
claude plugin update otomatik-devir@muctebadikmen
claude plugin update ilerleme-cubugu@muctebadikmen
claude plugin update my-skills@muctebadikmen
```

Sonra Claude Code'u yeniden başlatın.

## Nasıl kullanılır

### otomatik-devir

Alt satırdaki durum çubuğunda `Devir: %X / eşik %60` görürsünüz (ilk yanıttan önce %0 görünür). Doluluk eşiği aşınca mod, **sor** modunda turun sonunda beklemeden Claude'a **tek bir devir mesajı** gönderir: çalışan her işi (subagent'lar, arka plan görevleri) bitir ve sonuçlarını işle, yeni görev, subagent ya da arka plan işi başlatma, her şey bitince devri yap (`my-skill-handoff`, yoksa modun kendi devir talimatı) ve devam prompt'unu en sonda bir kod bloğunda ver. Subagent'lar bitip sonuç getirdikçe gelen ara turlar hata sayılmaz; durum satırında `Devir: N subagent bitiyor` görünür. Bekleme sınırlıdır. Devam prompt'u şunlardan biri olunca hâlâ gelmemişse mod bir kez kısa bir hatırlatma gönderir: kod bloğuyla bitmeyen 6 tur geçti, çalışan subagent kalmadan 5 dakika hiç tur olmadı ya da devir mesajından 30 dakika geçti. Hatırlatma sayaçları sıfırlar (6 tur / 5 dakika / 30 dakika yeniden başlar). Hatırlatmadan sonra da prompt gelmezse "devam prompt'u bulunamadı" der ve bekleme biter; en fazla bir hatırlatma gider, sonsuza dek beklenmez.

Prompt gelince:
- **sor** modunda (varsayılan) "Devam prompt'u hazır. Yeni sohbet açayım mı?" diye sorar: **g** = Geç, **b** = Bekle. "Geç" (ya da `/devir gec`) Claude masaüstü uygulamasında devam sohbeti için bir kart açar; karta tıklayınca devam prompt'uyla yeni bir üst seviye sohbet açılır ve iş orada kaldığı yerden sürer.

**otomatik** modunda yeni sohbet tıklamasız açılır. Uygulama `start_session` ile yeni sohbeti yalnızca sizin yazdığınız bir tur açıkken başlatır; başka turlarda mod devri bir zamanlanmış görevle yaptırır. Turun sizin olup olmadığına mesajın kaynağına bakarak değil, uygulamanın kendisine sorarak karar verilir: devam prompt'u hazır olunca Claude salt okunur `list_start_targets` aracını çağırır. Bu turda `start_session` geçecekse araç bilgisayarınızdaki depoları listeler, geçmeyecekse boş döner; mod sonucu okur ve Claude'a yolu söyler: (a) ya da (s). Hiç deponuz yoksa liste her zaman boştur; o zaman mesajın kaynağı karar verir, uygulama `start_session`'ı "sizin sözünüz değil" diye reddederse aynı turda (s)'ye geçilir.
- **(a) Eşik sizin yazdığınız tur sürerken aşılırsa:** talimat o turun içinde, bir araç sonucunun ardından Claude'a gider: elindeki adımı bitir, yeni iş başlatma, devri yap (`my-skill-handoff`) ve aynı turda, tur bitmeden yeni sohbeti aç (`start_session`, `user_asked`, `fresh`). Mod başlığı ("… (devam)") ve eksik alanları tamamlar (çalışma ağacı uygulamanın varsayılanıdır), aynı anda ya da ikinci kez açmayı engeller, sonuç metninde oturum kimliği olmasa da sohbeti açılmış sayar ve açılan sohbeti üst seviyeye taşır. Devir sürerken `hand_off_to_session` reddedilir; başka bir modun araç çağrısı talimatı taşımaz.
- **(s) O an açık bir yazılı tur yoksa** (eşik bir bildirim turunda, bir modun mesajında ya da kendiliğinden devam eden bir turda aşıldıysa, ya da tur az önce bittiyse): talimat bir araç sonucunun ardından, araç çağrısı kalmadıysa modun tek mesajıyla Claude'a gider. Claude devri yapar (`my-skill-handoff`), devam prompt'unu projenin `.workflow/otomatik-devir-devam.md` dosyasına yazar ve bu klasörün iki zamanlanmış görevinden (`otomatik-devir-<kısa kod>-a` ve `-b`) bu sohbetin kendi görevi olmayanı çalıştırır. Görevler bir kez oluşturulur, hep yeniden kullanılır ve **hiç silinmez** (silmek, görevin açtığı devam sohbetlerini arşivler); mod silme ve güncelleme çağrılarını reddeder. Görevin prompt'u sabittir: "devam prompt'u bu dosyada: önce onu oku, sonra devam et". Yeni sohbet hemen, tıklamasız, aynı klasör ve modelle açılır; izin modu görevin kayıtlı modudur. Ardından Claude yeni sohbetin effort'unu (gerekirse modelini) bu sohbetinkine eşitler; izin modunu değiştirmez. Effort yeni sohbetin ikinci turundan geçerli olur: ilk tur görevin varsayılan effort'uyla çalışır. (Bu, `send_message` aracı olmayan eski uygulamalardaki yoldur; masaüstü uygulamasında v0.5 zinciri kullanılır, aşağıda.)
- **Sonsuz zincir (v0.5, Claude masaüstü):** `/devir otomatik` açıkken zincirin her sohbeti, sizin açmadığınız zamanlanmış görev sohbetleri de, tıklamasız ve aynı model, effort ve izin moduyla devretmeye devam eder. Kapı kapalıysa (sizin yazmadığınız bir tur) Claude devam prompt'unu `.workflow/otomatik-devir-devam.md` dosyasına yazar ve turu tek satırla bitirir; görevi Claude değil mod çalıştırır:
  - **Normal bir sohbette** (bir görevin çalışması değilse) mod görevi kendisi çalıştırır.
  - **Bir görev sohbetinde** (uygulama kuralı: görev sohbeti görev çalıştıramaz) mod isteği modun ortak deposuna bırakır; **aktarıcı** onu alır. Aktarıcı, uygulama açıkken modun yüklü olduğu, görev sohbeti olmayan ve **izin modu Bypass ya da Auto olan** herhangi bir açık sohbettir (çoğu zaman zinciri başlattığınız ilk sohbet). Bu şart, aktarıcının görev çalıştırırken ya da ayar eşitlerken arka planda kimsenin görmediği bir onay penceresine takılmaması içindir; varsayılan moddaki bir sohbet aktarıcı olmaz. Aktarıcı yalnızca **otomatik** modda ve bekleyen bir istek varken ortak depoya yazar. Birden çok aday varsa biri seçilir (5 saniyede bir kalp atışı); 30 saniye ses vermezse başka bir sohbet devralır. Bir isteğin gönderimi 3 dakikada bitmezse aktarıcı kilidi bırakır ve istek sıraya geri döner. Her isteğin görevi bir kez çalıştırılır: çalıştırma başlayınca bir işaret yazılır, işaretli istek yeniden gönderilmez. Ortak görev o an çalışıyorsa 10 dakikaya kadar 30 saniyede bir yeniden denenir. Uygulama görev sohbetinde kapıyı (`list_start_targets`) reddettiği için ("Starting sessions requires a user at the keyboard; this session runs unattended…") görev sohbetinde kapı adımı yoktur: Claude devam prompt'unu yanıtının sonunda tek bir kod bloğu olarak verir, mod turun sonunda isteği aktarıcıya bırakır. Kapı başka bir sohbette hata verirse de "kapalı" sayılır.
  - Görevin prompt'u yalnızca bir **açılış turudur** ("yalnızca `hazır` yaz ve dur"): araç çağırmaz, izin kartına takılmaz. Görevi çalıştıran (mod ya da aktarıcı) sonra yeni sohbetin effort'unu ve modelini (farklıysa) eşitler ve asıl prompt'u `send_message` ile gönderir; sonuçta "delivery: delivered" ya da "queued" yazmıyorsa mesaj gitmemiş sayılır. **İzin modu hiç değiştirilmez** (bir modu yükseltmek her zaman onay kartı açar): yeni sohbet görevin kayıtlı izin moduyla başlar. Bu yüzden zincir yalnızca izin modu Auto ya da Bypass olarak kayıtlı görev çiftlerini kullanır ("devam prompt'u bu dosyada: önce onu oku, sonra devam et"). İş ikinci turda doğru ayarlarla başlar. Uygulama bu mesajı gönderen sohbetin adıyla gösterdiği için (çoğu zaman ilgisiz bir aktarıcı sohbet) mesaj, otomatik devrin başka bir sohbetten iletilen devamı olduğunu söyleyen tek satırlık bir Türkçe notla başlar. Görevin `SKILL.md` dosyasına zincirin modeli `model:` satırı olarak yazılır.
  - **Ön hazırlık:** sizin yazdığınız bir turda (araya makine girdisi karışmamış, çalışan subagent yok) izin modunuz Auto ya da Bypass ise ve bu klasörün o modla kayıtlı görev çifti yoksa mod Claude'a bir kez yeni çifti oluşturmasını söyler (`otomatik-devir-<kısa kod>-<kuşak>a` / `-<kuşak>b`). Uygulama izin modunu yalnızca böyle bir turda oluşturulan göreve kaydeder; mod oluşturma sonucundan modun kaydedilip kaydedilmediğini uygulamanın cümlesinden okur ("This task was saved in Bypass permissions mode…" ya da Auto karşılığı: kaydedildi; "This session's permission mode was not saved with this task": kaydedilmedi). Tanınmayan bir cümle kaydedilmedi sayılmaz: o çift kullanılmaz ama günlük sınırdan düşmez. Bir sohbetin isteği aynı klasördeki diğer sohbetleri yalnızca o sohbetin turu bitene kadar, en fazla 10 dakika bekletir. Kaydedilmediyse eski çift silinmez (silmek sohbetleri arşivler); sonraki uygun turda yeni bir kuşak istenir, ama bir klasörde aynı gün 2 "kaydedilmedi" sonucundan sonra ertesi güne (ya da `/devir otomatik` yeniden yazılana) kadar istenmez. Görev sohbetlerinde, makinenin açtığı turlarda ve çalışan subagent varken hiç istenmez.
  - **Bir kerelik ayar:** bu klasörde izin modu kayıtlı çift yoksa görev çalıştırılmaz; devir bir sonraki mesajınızı bekler (b) ve mod klasör başına bir kez bunu anlatan bir uyarı gösterir. Düzeltmek için iki yol var: bu klasördeki normal bir sohbette, izin modunu uygulamanın mod menüsünden Auto ya da Bypass seçmişken herhangi bir mesaj yazın (mod o turda kayıtlı çifti Claude'a oluşturtur) ya da uygulamada Zamanlanmış görevler'de `otomatik-devir-…` görevlerini düzenleyip izin modunu bir kez seçin. Bir görev sohbeti açıldığında mod onun hangi izin moduyla başladığını da kaydeder.
  - Mod, kendi görevinin çalışması olan bir sohbeti zincirin parçası sayar: orada `/devir otomatik` gerekmez, eşik aynıdır (`/devir kapat` yine durdurur).
  - Mod görevi çalıştıramazsa Claude çalıştırır; aktarıcı da olmazsa devir o sohbette bir sonraki mesajınızı bekler (b). Modun kendi devri 10 dakikada bitmezse de (b)'ye geçilir. Mod devri açarken Claude'un kendi görev çalıştırması reddedilir (ikinci sohbet açılmasın diye).
- **(b) Zamanlanmış görev araçları yoksa ya da (s) olmazsa:** devir bekletilir ve sizin **bir sonraki mesajınızla** yapılır. O mesajınızın isteği bu sohbette yapılmaz; devam prompt'una eklenir ve yeni sohbetin ilk işi olur (kart ya da pano yedeğinde de hazır prompt'un altına eklenir). Talimat, çalışan subagent'ların ve arka plan işlerinin bitmesini bekletir. Mesajınızı çalışan bir tura yazarsanız devir o turda da başlayabilir. `/devir simdi` de otomatik modda bunu yapar; bu bekleyiş doluluk eşiğin altına inince iptal olmaz.
- **Talimattan sonra yazdıklarınız:** talimatı almamış bir turunuzun yanıtı (örneğin kod bloğuyla biten bir cevap) devam prompt'u sayılmaz. Devir o tur bitmeden olmadıysa talimat bir kez bir sonraki mesajınıza biner; yine olmazsa "devam prompt'u bulunamadı" der ve devir bırakılır. Çalışan bir subagent varken yazdığınız mesaj devri bıraktırmaz; mesajınız olduğu gibi geçer.
- **Son çare:** Claude yeni sohbeti açamazsa ya da açmazsa öneri kartı çıkar ("Devam kartı hazır"); karta tıklamanız gerekir. Mod kartı en fazla 2 saat izler (5 saniyede bir bakar) ve siz başlatınca yeni sohbeti üst seviyeye taşır. Oturum araçları yoksa (örneğin terminalde) prompt panoya kopyalanır ve ekranda "Yeni sohbet açıp yapıştır" yazar. Yeni sohbetin izin sorusuna siz "hayır" derseniz kart açılmaz; prompt saklanır, `/devir gec` ile açabilirsiniz.
- (a)'da yeni sohbet açılmazsa (örneğin prompt sizin yazmadığınız bir turda hazır olduysa) önce (s), o da yoksa (b) bir kez denenir, sonra kart gelir. Prompt hiç gelmezse hatırlatma mesajı gitmez: devir bir kez bir sonraki mesajınıza taşınır, yine gelmezse "devam prompt'u bulunamadı" der ve bekleme biter.
- **Geç kalan adımlar:** bekleme sınırı dolsa da (örneğin Claude arka planda süren bir derlemeyi beklemek için turu bitirdiyse) Claude'un o devir için sonradan yaptığı adımlar sayılır: `list_start_targets` sorusu yine yolu alır, görev çalıştırması ya da `start_session` izlenir, sizin yazmadığınız bir turda gelen devam prompt'u saklanır. Böylece bir sonraki mesajınız ikinci bir sohbet açmaz. Uygulamanın kendi uyandırma mesajı (sizin yazmadığınız ama öyle görünen mesaj) kapı kapalı derse bir sonraki mesaj hakkını harcamaz ve kart açmaz. Zamanlanmış görev yolu hâlâ mümkünken Claude kendi kartını açmaya kalkarsa mod bunu reddeder ve görev yoluna yönlendirir.

Eski sohbet temizlenmez, açık kalır.

| Komut | Ne yapar |
|---|---|
| `/devir` | Durumu gösterir |
| `/devir esik 70` | Eşiği %70 yapar (1-99) |
| `/devir otomatik` | Sormadan yeni sohbete geçer |
| `/devir sor` | Geri sorarak geçmeye döner (varsayılan) |
| `/devir simdi` | Devri hemen başlatır |
| `/devir gec` | Bekleyen devirde yeni sohbete geçer |
| `/devir kapat` / `/devir ac` | Modu kapatır / açar |

Kendi devir becerisi (`my-skill-handoff`) olanlarda mod onu kullanır. Olmayanlarda kendi hazır devir talimatını gönderir; ekstra bir şey kurmanız gerekmez.

### ilerleme-cubugu

İki kaynaktan çubuk çizer:

1. **Claude'un görev listesi.** Claude bir işi adımlara bölüp görev listesi tuttuğunda çubuk kendiliğinden çıkar.
2. **Plan dosyası.** `PLAN.md`, `.workflow/PLAN.md`, `.workflow/STATE.md` ya da `.workflow/plans/<klasör>/PLAN.md`. Kutucuklar (`- [x]`, `- [ ]`), numaralı adımlar ve `- id: T1` biçimli planlar okunur. Plan dosyasının çubuğu **o dosyalardan bahseden sohbete** bağlanır: mesajınızda `PLAN.md` ya da `STATE.md` geçtiğinde ya da Claude bu dosyaları okuyup yazdığında çubuk çıkar. Aynı projede açtığınız alakasız bir sohbette eski plan görünmez.
3. **İlerleme kaydı.** Planın klasöründe `.workflow/plans/<klasör>/PROGRESS.md` varsa adımların durumu oradan okunur: `[ ]` bekliyor, `[~]` sürüyor, `[x]` bitti, `[!]` engelli, `[-]` iptal (toplama katılmaz). Kayıt yoksa durum `STATE.md`'den okunur; oradan da okunamazsa çubukta `⚠ ilerleme kaydı okunamadı` uyarısı çıkar.

Videodaki gibi başlatmak için örnek mesaj:

```
.workflow/PLAN.md ve .workflow/STATE.md: benim için bu formatta bir plan yap ve bu planı uygula. <işin tarifi>
```

Çubuk tek adım sürüyorsa `Şu an: <adım>`, birden fazla adım aynı anda sürüyorsa `Şu an N iş üzerinde çalışılıyor`, hiçbiri sürmüyorsa `Sıradaki: <adım>` yazar.

Çubuğa tıklarsanız adım listesi açılır: ✓ biten, ● süren, ○ bekleyen.

| Komut | Ne yapar |
|---|---|
| `/ilerleme detay` | Adım listesini açar / kapatır (çubuğa tıklamak da aynı işi yapar) |
| `/ilerleme gizle` | Çubuğu gizler |
| `/ilerleme goster` | Çubuğu geri getirir |

İki mod birlikte çalışır: devirden sonra yeni sohbete yapıştırılan devam prompt'u plan ya da devir dosyalarından (`PLAN.md`, `STATE.md`, `HANDOFF.md`) bahsettiğinde çubuk yeni sohbette de geri gelir. Bahsetmiyorsa Claude o dosyaları okuduğu anda gelir.

## Kaldırma

```bash
claude plugin uninstall otomatik-devir@muctebadikmen --scope user
claude plugin uninstall ilerleme-cubugu@muctebadikmen --scope user
claude plugin uninstall my-skills@muctebadikmen --scope user
claude plugin marketplace remove muctebadikmen
```

## Güvenlik

Modlar Claude Code'un içinde sizin yetkilerinizle çalışır, bu yüzden kurmadan önce bakmanız doğru. Kodun tamamı bu depoda; `modlar/<mod>/hooks/` klasörlerinde okuyabilirsiniz. Depoyu indirip bir modu kendiniz de denetleyebilirsiniz:

```bash
claude plugin validate modlar/otomatik-devir
claude plugin validate modlar/ilerleme-cubugu
```

Çıktı, modun hangi işlemleri yaptığını listeler. İki modun listesinde de ağ çağrısı yoktur. ilerleme-cubugu yalnızca proje klasöründeki plan dosyalarını okur, hiçbir dosyaya yazmaz. otomatik-devir devam notunu Claude'a yazdırır; kendisi yalnızca devam dosyasını (Claude'un verdiği prompt'la, dosya eksikse) ve kendi görevlerinin `SKILL.md` dosyasındaki `model:` satırını yazar; **sor** modunda devir anında Claude'a tek bir devir mesajı (prompt gelmezse en fazla bir hatırlatma) gönderir. **otomatik** modda talimatı Claude'un süren turuna (bir araç sonucuna ya da sizin mesajınıza) ekler; açık tur kalmadıysa zamanlanmış görev yolu için tek bir mesaj gönderir, hatırlatma göndermez. Yeni sohbeti masaüstü uygulamasının oturum ve zamanlanmış görev araçlarıyla açar: sizin turunuzda Claude, diğer turlarda (v0.5) mod ya da aktarıcı; mod ayrıca son çare kartını açar.

## Bilinen sınırlar

- **otomatik-devir:** Alt komutlar Türkçe harfsiz yazılır: `esik`, `simdi` (`eşik` çalışmaz). Devir yanıtı bir kod bloğuyla bitmezse o tur ara tur sayılır (6 ara tur, 5 dakika boşta ya da 30 dakika dolunca tek hatırlatma gider ve sayaçlar sıfırlanır); hatırlatmadan sonra da prompt gelmezse "devam prompt'u bulunamadı" der. Otomatik modda tıklamasız başlatma, sizin yazdığınız turda Claude'un `start_session` çağırmasına, başka turlarda zamanlanmış görevi çalıştırmasına bağlıdır; turun sizin olup olmadığını `list_start_targets` söyler (hiç deponuz yoksa mesajın kaynağı, sonra uygulamanın reddi); ikisi de olmazsa yeni sohbet bir sonraki mesajınızla, o da olmazsa kart tıklamasıyla açılır. Zamanlanmış görevle açılan sohbetin ilk turu görevin varsayılan effort'uyla çalışır; aynı klasörde aynı anda iki sohbet devrederse ikisi aynı devam dosyasını yazar. Bir sonraki mesajınızı bekleyen devir, uygulama yeniden başlayınca unutulur; eşik yeniden aşılınca devir baştan başlar. Kart tıklanmadan kalırsa yeni sohbet kartı tıklayınca açılır. Mod yalnızca kendi görevlerini (`otomatik-devir-<8 haneli kod>-a` / `-b`) korur; aynı adla başlayan kendi görevlerinize dokunmaz. Bu koruma Claude Code'dan geçen araç çağrılarını kapsar (Claude, subagent'lar, başka modlar); uygulamanın arayüzünden ya da başka bir istemciden silinen görevler ve arşivlenen devam sohbetleri korunamaz. Depo listesinin bir kez dolu görüldüğü bilgisayar genelinde saklanır; deposu olmayan bir klasörde ya da SSH oturumunda sizin turunuzda da (a) yerine (s) seçilebilir (ikisi de tıklamasızdır). Kart açıldıktan sonra Claude görevi de çalıştırırsa ve siz karta da tıklarsanız iki sohbet açılabilir. Yeni sohbet hiç açılamazsa (oturum araçları yoksa, örneğin terminalde) devam metni panoya kopyalanır ve ekranda "Yeni sohbet açıp yapıştır" yazar; `/devir gec` ile yeniden denenebilir. **Sonsuz zincir (v0.5):** görev sohbetlerinin devri için uygulama açık olmalı ve modun yüklü olduğu, görev sohbeti olmayan en az bir sohbet açık durmalıdır (aktarıcı); yoksa istek 30 dakika bekler, sonra o sohbet bir sonraki mesajınızı bekler. Bypass ya da Auto modunda açık bir normal sohbet yoksa aktarıcı yoktur. Mod, kendi görevinin çalışması olan sohbette `/devir sor` ayarını eşik için yok sayar, ama **sor** modunda aktarıcı çalışmaz; o sohbetin devri bir sonraki mesajınızı bekler. Zincir yalnızca izin modu kayıtlı görev çiftleriyle tıklamasızdır (yukarıdaki bir kerelik ayar). Uygulamada elle seçilen modu mod, görev listesi bu bilgiyi verirse ya da o görevin bir sohbeti açıldığında görür. Ortak depo bir JSON dosyasıdır ve karşılaştır-yaz desteği yoktur: istek ve aktarıcı kilidi "yaz, bekle, geri oku" ile alınır; bir aktarıcı yarıda kalırsa istek yeniden gönderilmez, o sohbet bir sonraki mesajınızı bekler. Devam mesajı gönderilemezse yeni sohbet "hazır" deyip durur; ekrandaki uyarı o sohbete ne yazacağınızı söyler. Her başarısız ön hazırlık bir kuşak harcar (görevler silinmez); bu bir klasörde günde en fazla 2 kuşaktır, toplamda en fazla 12. Zincir aynı klasörde tek devam dosyası kullanır.
- **ilerleme-cubugu:** Plan dosyasını editörde elle değiştirirseniz çubuğun güncellenmesi birkaç saniye sürebilir. Plan çubuğu yalnız o dosyalardan bahseden sohbette görünür. İş bitince çubuk kısa bir süre "✓ Tamamlandı" gösterip kaybolur.
- **Yazı kutusunun üstündeki şerit paylaşılır:** iki mod (ve varsa başka modlar) aynı şeride çizer. Başka modun düğmeleri (ör. "Geç / Bekle") her zaman üstte kalır; adım listesi açıkken bile onları ekrandan itmez.

## Geliştirenler için

Her modun testleri `modlar/<mod>/tests/` içinde. Çalıştırmak için mod klasöründe:

```bash
claude plugin test .
```

## Lisans

MIT. Kullanın, değiştirin, paylaşın. Sorun görürseniz bir issue açın ya da Skool topluluğunda yazın.
