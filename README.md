# Claude Code Araçları

Kendi işimde her gün kullandığım Claude Code modları. Kod yazmadan, Claude'a anlatarak yaptırdım; burada herkes için paylaşıyorum.

🎥 **Videoda nasıl çalıştıklarını gösterdim:** https://youtu.be/-B0hXhOzuUI
🏫 **Soru, destek ve yeni araçlar için ücretsiz Skool topluluğu:** https://www.skool.com/mustafa-dikmen-ile-yapay-zeka-1691/about

| Mod | Ne yapar |
|---|---|
| **otomatik-devir** | Sohbetin bağlamı dolmaya yaklaşınca işi güvenli bir yerde bitirtir, devam notu yazdırır, sohbeti temizleyip işe kaldığı yerden devam ettirir. |
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

Alt satırdaki durum çubuğunda `Devir: %X / eşik %60` görürsünüz (ilk yanıttan önce %0 görünür). Doluluk eşiği aşınca mod, işi güvenli bir noktada bitirtir ve devam notu yazdırır (`.workflow/HANDOFF.md`). Sonra "Yeni sohbete geçeyim mi?" diye sorar: **g** = Geç, **b** = Bekle. "Geç" dediğinizde sohbeti temizler (`/clear`), devam prompt'unu yapıştırır ve iş kaldığı yerden sürer.

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

Çıktı, modun hangi işlemleri yaptığını listeler. İki modun listesinde de ağ çağrısı yoktur. ilerleme-cubugu yalnızca proje klasöründeki plan dosyalarını okur, hiçbir dosyaya yazmaz. otomatik-devir devam notunu Claude'a yazdırır, kendisi dosya yazmaz; devir anında sohbeti temizleyip devam prompt'unu gönderir.

## Bilinen sınırlar

- **otomatik-devir:** Alt komutlar Türkçe harfsiz yazılır: `esik`, `simdi` (`eşik` çalışmaz). Devir yanıtı bir kod bloğuyla bitmezse "devam prompt'u bulunamadı" der. Sohbet temizlenemezse devam metni panoya kopyalanır ve ekranda "/clear yazıp yeni sohbete yapıştır" yazar.
- **ilerleme-cubugu:** Plan dosyasını editörde elle değiştirirseniz çubuğun güncellenmesi birkaç saniye sürebilir. Plan çubuğu yalnız o dosyalardan bahseden sohbette görünür. İş bitince çubuk kısa bir süre "✓ Tamamlandı" gösterip kaybolur.
- **Yazı kutusunun üstündeki şerit paylaşılır:** iki mod (ve varsa başka modlar) aynı şeride çizer. Başka modun düğmeleri (ör. "Geç / Bekle") her zaman üstte kalır; adım listesi açıkken bile onları ekrandan itmez.

## Geliştirenler için

Her modun testleri `modlar/<mod>/tests/` içinde. Çalıştırmak için mod klasöründe:

```bash
claude plugin test .
```

## Lisans

MIT. Kullanın, değiştirin, paylaşın. Sorun görürseniz bir issue açın ya da Skool topluluğunda yazın.
