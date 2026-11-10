# Claude Code Araçları

Kendi işimde her gün kullandığım Claude Code modları. Kod yazmadan, Claude'a anlatarak yaptırdım; burada herkes için paylaşıyorum.

🎥 **Videoda nasıl çalıştıklarını gösterdim:** https://youtu.be/-B0hXhOzuUI
🏫 **Soru, destek ve yeni araçlar için ücretsiz Skool topluluğu:** https://www.skool.com/mustafa-dikmen-ile-yapay-zeka-1691/about

| Mod | Ne yapar |
|---|---|
| **ilerleme-cubugu** | Süren işin ilerlemesini yazı kutusunun üstünde çubuk olarak gösterir: kaç adımın bittiği, yüzde kaç olduğu ve şu an hangi adımda olunduğu. |

> "Mod", Claude Code'un içine takılan küçük bir eklentidir. Claude Code'un görünüşünü ve davranışını değiştirir.

## Kurulum

**Gerekli:** Claude Code 2.1.287 veya üstü. Terminalde `claude --version` yazıp bakın; eskiyse `claude update`.

### Yol 1: Claude'a kurdurun (en kolayı)

Claude Code'u açın ve şu metni olduğu gibi yapıştırın. Komut çalıştırma izni isteyecek, onaylayın.

```
Şu 2 komutu sırayla çalıştır, başka hiçbir şey kurma veya değiştirme: (1) claude plugin marketplace add muctebadikmen/claude-code-araclari (2) claude plugin install ilerleme-cubugu@muctebadikmen --scope user. Sonunda claude plugin list çalıştır ve modun "enabled" olduğunu söyle. Hata olursa dur ve bana hatayı anlat.
```

### Yol 2: Terminalden

```bash
claude plugin marketplace add muctebadikmen/claude-code-araclari
claude plugin install ilerleme-cubugu@muctebadikmen --scope user
claude plugin list
```

`--scope user` "tüm projelerimde geçerli olsun" demektir. Listede modu "enabled" görmelisiniz. Sonra Claude Code'da yeni bir sohbet açın ya da `/reload-plugins` yazın.

## Skill'ler: my-skills

Her gün kullandığım iş akışı skill'leri. Ana sohbet işi yönetir, alt ajanlar işi yapar; durum `.workflow/` klasöründe tutulur, böylece iş yeni bir sohbette kaldığı yerden sürer.

| Skill | Ne yapar |
|---|---|
| **my-skill-orchestrate** | Diğer tüm skill'lerin uyduğu kurallar: işi alt ajanlara paralel dağıtır, `.workflow/STATE.md`'yi güncel tutar |
| **my-skill-init** | Projeyi başlatır: stack'i algılar (`PROJECT.md`), `STATE.md`, `AGENTS.md` kuralları, `.gitignore` |
| **my-skill-audit** | Koddaki gerçek sorunları bulur, kanıtlar ve önem sırasına dizer |
| **my-skill-research** | Kodu ve web'i araştırıp tek bir öneri çıkarır |
| **my-skill-masterplan** | Doğrulanmış, paralel görevlere bölünmüş plan yazar |
| **my-skill-execute** | Planı alt ajanlarla test-first uygular, her işi geri dönüşte inceler |
| **my-skill-debug** | Tek bir hatayı tekrarlatır, kök nedenini bulur ve testle düzeltir |
| **my-skill-verify-app** | Değişikliği simülatörde/emülatörde çalıştırıp kanıtla doğrular |
| **my-skill-persona-test** | Uygulamayı farklı kullanıcı tipleriyle kullanır, UX sorunlarını ve önerileri raporlar |
| **my-skill-release** | Mağaza öncesi salt okuma kontrolü (sürüm, imza, metadata) |
| **my-skill-vet** | Başkasının skill'ini/reposunu kullanmadan önce güvenlik kontrolü yapar |
| **my-skill-handoff** | İlerlemeyi dondurur, yeni sohbet için devam prompt'u yazar |
| **my-skill-ship** | Gizli bilgi taraması (gönderilmemiş commit'ler dahil), doğrulama, commit ve push |

**Akışlar:** Hata için `audit → debug/masterplan → execute → ship`. Yeni özellik için `research → masterplan → execute → ship`; execute sonunda `verify-app`. `handoff` her an kullanılabilir.

**Koruma hook'ları (isteğe bağlı):** `skilller/my-skills/hooks/` içinde, force-push ve `reset --hard` gibi geri alınamayan git komutlarını ve `.env` gibi gizli dosyaların okunmasını engelleyen iki küçük script var. Otomatik kurulmazlar; kurulum `hooks/README.md` içinde.

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
claude plugin update ilerleme-cubugu@muctebadikmen
claude plugin update my-skills@muctebadikmen
```

Sonra Claude Code'u yeniden başlatın.

## Nasıl kullanılır

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

Sıkıştırmadan sonra ya da yeni sohbette devam prompt'u plan dosyalarından (`PLAN.md`, `STATE.md`, `HANDOFF.md`) bahsettiğinde çubuk geri gelir. Bahsetmiyorsa Claude o dosyaları okuduğu anda gelir.

### otomatik-devir

Uzun bir işi tek sohbette saatlerce sürdürmek için. Varsayılan olarak kapalıdır; yalnızca açtığınız sohbette çalışır. Bağlam eşiğe gelince Claude'a yeni iş başlatmamasını ve devam prompt'unu `.workflow/devir/<sohbet-kimliği>.md` dosyasına yazmasını söyler. Dosya yazılıp tur bitince sohbeti sıkıştırır ve işi o prompt'la aynı sohbette kendiliğinden sürdürür; arka planda süren alt ajanlar ve komutlar çalışmaya devam eder, sonuçları sıkıştırmadan sonra gelir. Claude dosyayı yazıp turu bitirmezse mod turu kendisi bitirir. Yeni sohbet açmaz.

| Komut | Ne yapar |
|---|---|
| `/devir` | Durum: açık mı, eşik, şu anki bağlam yüzdesi |
| `/devir ac [eşik]` | Bu sohbette açar (eşik %20-90, varsayılan %60) |
| `/devir esik <n>` | Bu sohbetin eşiğini değiştirir |
| `/devir kapat` | Bu sohbette kapatır, süren devri iptal eder |
| `/devir simdi` | Yüzdeye bakmadan devri hemen başlatır |

Açık olduğu sohbette durum satırında `Devir açık · eşik %60 · şu an %34` yazar. Devam prompt'u iki denemede de yazılmazsa devir bu seferlik bırakılır, uyarı verilir ve iş sürer; bağlam biraz daha dolunca devir yeniden dener.

## Kaldırma

```bash
claude plugin uninstall ilerleme-cubugu@muctebadikmen --scope user
claude plugin uninstall my-skills@muctebadikmen --scope user
claude plugin marketplace remove muctebadikmen
```

## Güvenlik

Modlar Claude Code'un içinde sizin yetkilerinizle çalışır, bu yüzden kurmadan önce bakmanız doğru. Kodun tamamı bu depoda; `modlar/<mod>/hooks/` klasörlerinde okuyabilirsiniz. Depoyu indirip bir modu kendiniz de denetleyebilirsiniz:

```bash
claude plugin validate modlar/ilerleme-cubugu
```

Çıktı, modun hangi işlemleri yaptığını listeler. ilerleme-cubugu'nun listesinde ağ çağrısı yoktur; yalnızca proje klasöründeki plan dosyalarını okur, hiçbir dosyaya yazmaz.

## Bilinen sınırlar

- **ilerleme-cubugu:** Plan dosyasını editörde elle değiştirirseniz çubuğun güncellenmesi birkaç saniye sürebilir. Plan çubuğu yalnız o dosyalardan bahseden sohbette görünür. İş bitince çubuk kısa bir süre "✓ Tamamlandı" gösterip kaybolur.
- **Yazı kutusunun üstündeki şerit paylaşılır:** mod (ve varsa başka modlar) aynı şeride çizer. Başka modun düğmeleri (ör. "Geç / Bekle") her zaman üstte kalır; adım listesi açıkken bile onları ekrandan itmez.

## Geliştirenler için

Her modun testleri `modlar/<mod>/tests/` içinde. Çalıştırmak için mod klasöründe:

```bash
claude plugin test .
```

## Lisans

MIT. Kullanın, değiştirin, paylaşın. Sorun görürseniz bir issue açın ya da Skool topluluğunda yazın.
