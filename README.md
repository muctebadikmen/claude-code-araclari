# Claude Code Araçları

Kendi işimde her gün kullandığım Claude Code modları. Kod yazmadan, Claude'a anlatarak yaptırdım; burada herkes için paylaşıyorum.

🎥 **Videoda nasıl çalıştıklarını gösterdim:** https://youtu.be/-B0hXhOzuUI
🏫 **Soru, destek ve yeni araçlar için ücretsiz Skool topluluğu:** https://www.skool.com/mustafa-dikmen-ile-yapay-zeka-1691/about

| Mod | Ne yapar |
|---|---|
| **otomatik-devir** | Orkestra modu: `/otomatik-devir:devir-otonom <görev>` yazdığınız sohbet ana sohbet olur; iş, bağlamı dolunca devam notu yazan iç içe alt sohbetlere tıklamasız ve sırayla bölünür, zincir bitince ana sohbet bir özet yazar. Normal sohbetler devredilmez. |
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

Sürüm 1.1.0. Otomatik devir artık yalnızca orkestra alt sohbetlerinde çalışır. Normal bir sohbet hiç devredilmez ve `Devir:` durum satırı göstermez; orada `/devir` yazarsanız tek satırla burada devir olmadığını söyler. Alt sohbet eşikte devir dosyasını yazar, sıradaki alt sohbeti ana sohbet açar. Devir tıklamasızdır: tek bir kurulum yolu, seçilecek bir mod yok.

**Devir sırasında alt ajanları bekleyen tur sonu koruması.** Alt sohbette eşik aşılıp devir başladıktan sonra Claude, alt ajanlar ve Workflow'lar çalışırken turu bitirmez; her seferinde en fazla 5 dakikalık beklemelerle bekler ve sonra turu bitirmeyi yeniden dener. Devir yokken ve "Devir hazır" durumunda (dosya yazılmış) çalışan alt ajanlar ve Workflow'lar turun bitmesini engellemez. Arka plan Bash, Monitor ve geliştirme sunucuları hiç beklenmez. Esc bu beklemeyi her zaman durdurur.

Bir alt sohbette devir başlamamışken sistem prompt'una bir bölüm ekler: Claude bağlam büyüdü diye kendi başına devir yapmaz (my-skill-orchestrate/execute'un "uzun sohbet" devri dahil); devri eşikte mod yapar. Alt sohbette modelin kendi başına my-skill-handoff çağırması engellenir. Yeni sohbet açmayı da mod yasaklar: sıradakini ana sohbet açar.

**Eşiğe gelince (alt sohbette):**
1. Mod Claude'a turun içinde tek bir talimat verir: elindeki adımı bitir, yeni iş başlatma, devir dosyasını yazdır (`my-skill-handoff auto`; beceri yoksa modun kendi devir talimatı). Dosyanın başına `Kalan: var` ya da `Kalan: yok` satırı konur.
2. Çalışan alt ajanlar bitene kadar sistem yeni alt ajan, Workflow, Task ya da alt ajana mesaj başlatmayı **koda bağlı olarak** reddeder (bu yalnızca talimat değil, araç çağrısı reddedilir). Durum satırında `Devir: N alt ajan bitiyor` görünür.
3. 30 dakika içinde bitmeyen işleri Claude `TaskStop` ile durdurur ve devir dosyasında "Yeniden çalıştır" başlığı altında listeler.
4. Devir dosyası `.workflow/handoff/<oturum-kimliği>.md` yoluna yazılır. Her sohbetin kendi dosyası olduğu için aynı klasördeki sohbetler birbirinin dosyasını ezmez. Yeni alt sohbete yalnızca bu dosyayı okuması söylenir; eski `.workflow/HANDOFF.md` ya da `STATE.md` dosyalarına yönlendirilmez.
5. Alt sohbet dosyayı yazıp turu bitirir; durum satırında `Devir hazır` görünür. Sıradaki alt sohbeti ana sohbet açar.

**Orkestra modu (v1.1).** `/otomatik-devir:devir-otonom <görev>` yazın; o sohbet ana sohbet olur. Ana sohbet işin kendisini yapmaz: iç içe alt sohbetleri `<görev> · 1`, `· 2` adlarıyla tıklamasız açar ve her birini bekler. Her alt sohbet eşikte devir dosyasını yazar, ana sohbet sıradakini o dosyadan açar. Zincir şu durumlarda durur ve ana sohbet bir özet yazar: `Kalan: yok`, biten bir alt sohbet, yanıt vermeyi bırakan bir alt sohbet, `/devir otonom dur` ya da sınır. Sınır varsayılan 100 alt sohbettir; `/devir otonom limit <n>` ile değişir (1-1000), yalnızca bu zincir için geçerlidir ve zincir sürerken de ayarlanabilir. Esc, çökme ya da yeniden başlatma olursa şeritte `Orkestra duraklatıldı: devam etmek için bir mesaj yaz.` çıkar; sonraki mesajınız zinciri sürdürür. Her alt sohbet kendi çok adımlı işini `my-skill-orchestrate` becerisiyle alt ajanlara dağıtır (model seçimi o becerideki yönlendirmeye göre, varsayılan sonnet). Ana sohbette (ya da `/otomatik-devir:devir-otonom` yazmadan önce o sohbette) yazılan `/devir dene` alt sohbetlere uygulanır. `/devir ac` gerekmez: `/otomatik-devir:devir-otonom <görev>` yazmak yeter. Eşik, sınır ve `/devir kapat` ana sohbette ya da bir alt sohbette yazılınca yalnızca o zinciri etkiler; başka zincirleri ve normal sohbetleri etkilemez. `/devir kapat` bu zinciri durdurur: ana sohbet özet yazar, yeni alt sohbet açılmaz, süren alt sohbet devri iptal edilir. Komut listesinde kısa `/devir-otonom` adı görünmez; `/devir` ise sohbetin ilk mesajından sonra çıkar (hemen gerekirse önce herhangi bir mesaj yazın).

Mevcut kurulumunuzda eski sürümden kalan `otomatik-devir-*` zamanlanmış görevleri varsa mod bunları ilk yüklemede bir kez siler (görevlerin çalıştırma sohbetleri arşivlenir; arşivden geri alınabilir) ve eski kayıt anahtarlarını temizler.

| Komut | Ne yapar |
|---|---|
| `/devir` | Durumu gösterir; normal sohbette tek satırla burada devir olmadığını söyler |
| `/otomatik-devir:devir-otonom <görev>` | Otonom zinciri başlatır; bu sohbet ana sohbet olur |
| `/devir otonom` | Orkestra durumunu ve sınırı gösterir |
| `/devir otonom dur` | Zinciri şu anki alt sohbetten sonra durdurur |
| `/devir otonom limit <n>` | Bu zincirin alt sohbet sınırını ayarlar (1-1000, varsayılan 100) |
| `/devir esik 70` | Bu zincirin alt sohbet eşiğini %70 yapar, ana ya da alt sohbette (1-99, varsayılan 60); başka zincirleri ve sohbetleri etkilemez; normal sohbette hiçbir şey değiştirmez |
| `/devir dene 20` | Bu sohbetin deneme eşiği; alt sohbette onun, ana sohbette ya da başlatmadan önce yazılınca zincirin alt sohbetlerinin; `/devir dene` yazınca kaldırır |
| `/devir simdi` | Alt sohbette devri hemen başlatır; normal sohbette devir yoktur |
| `/devir kapat` / `/devir ac` | Acil durdurma: yazıldığı zinciri durdurur ve süren alt sohbet devrini iptal eder; başka zincirleri ve sohbetleri etkilemez; normal sohbette hiçbir şey değiştirmez. Yazılmış devir dosyası yerinde kalır. `/devir ac` hiçbir şey yazmaz, kapatılan ya da biten zinciri sürdürmez: yeni zincir `/otomatik-devir:devir-otonom <görev>` ile başlar. |

v0.x'teki mod ve geçiş komutları v1.0'da kaldırıldı. Eski komutları yazarsanız mod bunu söyleyen bir yanıt verir. Zinciri durdurmak için `/devir kapat`.

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

Çıktı, modun hangi işlemleri yaptığını listeler. İki modun listesinde de ağ çağrısı yoktur. ilerleme-cubugu yalnızca proje klasöründeki plan dosyalarını okur, hiçbir dosyaya yazmaz. otomatik-devir devam notunu Claude'a yazdırır (`.workflow/handoff/<oturum-kimliği>.md`); kendisi mod açıkken sistem prompt'una devri kendisinin yönettiğini söyleyen bir bölüm ekler, eşikte Claude'un süren turuna talimat ekler, alt ajan ve Workflow başlatmayı eşikten sonra reddeder ve devir sürerken alt ajanlar ya da Workflow'lar çalışıyorsa turun bitmesini engeller. Alt sohbetleri ana sohbetteki Claude'a masaüstü uygulamasının oturum aracıyla (`start_session`) açtırır. Orkestra modu bu sohbet için `get_session` çağırır ve küçük JSON kayıtlarını `~/.claude/plugins/data/otomatik-devir/orkestra/` altına yazar. Her zincirin eşiğini, sınırını ve durdurma bayrağını ana sohbetin kimliğiyle anahtarlanan tek bir küçük ayar kaydında tutar (dosya olarak `ayar-<kimlik>.json`, aynı klasörde); genel `esik`/`acik` anahtarları artık kullanılmaz. İlk yüklemede eski sürümün `otomatik-devir-*` zamanlanmış görevlerini siler.

## Bilinen sınırlar

- **otomatik-devir:** Alt komutlar Türkçe harfsiz yazılır: `esik`, `simdi` (`eşik` çalışmaz). Tur sonu koruması yalnızca alt ajanları ve Workflow'ları bekler; arka plan Bash, Monitor ve geliştirme sunucuları beklenmez. 30 dakikada bitmeyen alt ajanlar durdurulur ve devir dosyasında "Yeniden çalıştır" olarak kalır.
  - Zincir `/otomatik-devir:devir-otonom <görev>` ile başlar: komut listesinde kısa `/devir-otonom` adı görünmez; `/devir` sohbetin ilk mesajından sonra çıkar.
  - Ana sohbet yazdığınız turun içinde kalmalıdır; tur kapanırsa zincir duraklar.
  - Devir dosyasını yazmadan ve bitmeden çalışmayı bırakan alt sohbet yaklaşık 10 dakikada fark edilir: zincir `Orkestra durdu: alt sohbet N yanıt vermiyor` ile durur ve ana sohbet özet yazar.
  - Hâlâ çalışırken takılan alt sohbet ana sohbeti bekletir (Esc, sonra `/devir otonom dur`).
  - Başlatma çağrısının tam ortasında bir çökme aynı alt sohbetin iki kez açılmasına yol açabilir.
  - `/devir kapat` kendi zincirini ana sohbetin sonraki adımında durdurur; devir dışında çalışan bir alt sohbet o anki turunu bitirir (öldürülmez).
  - Ana sohbetin kendi bağlamı %80'e gelirse zincir sıradaki alt sohbet sınırında bir özetle biter; özet, hazır devir dosyasından yeni bir zincirde nasıl devam edileceğini söyler.
  - Ayarlar zincire özgüdür: bir zincirin eşiği, sınırı ya da durdurması o zincirin ana sohbetinde ya da alt sohbetlerinden birinde yazılmalıdır. Bir alt sohbet devir yaparken durumu `Devir hazır` görünür; `/devir kapat` o devri iptal eder ve ana sohbet sonraki adımında durur.
- **ilerleme-cubugu:** Plan dosyasını editörde elle değiştirirseniz çubuğun güncellenmesi birkaç saniye sürebilir. Plan çubuğu yalnız o dosyalardan bahseden sohbette görünür. İş bitince çubuk kısa bir süre "✓ Tamamlandı" gösterip kaybolur.
- **Yazı kutusunun üstündeki şerit paylaşılır:** iki mod (ve varsa başka modlar) aynı şeride çizer. Başka modun düğmeleri (ör. "Geç / Bekle") her zaman üstte kalır; adım listesi açıkken bile onları ekrandan itmez.

## Geliştirenler için

Her modun testleri `modlar/<mod>/tests/` içinde. Çalıştırmak için mod klasöründe:

```bash
claude plugin test .
```

## Lisans

MIT. Kullanın, değiştirin, paylaşın. Sorun görürseniz bir issue açın ya da Skool topluluğunda yazın.
