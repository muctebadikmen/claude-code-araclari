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

Sürüm 1.0.0. Alt satırdaki durum çubuğunda `Devir: %X / eşik %60` görürsünüz (ilk yanıttan önce %0 görünür). Devir tek modludur ve tıklamasızdır: tek bir kurulum yolu, seçilecek bir mod yok.

**Alt ajanları bekleyen tur sonu koruması.** Mod açıkken Claude, alt ajanlar ve Workflow'lar çalışırken turu bitirmez; her seferinde en fazla 5 dakikalık beklemelerle bekler ve sonra turu bitirmeyi yeniden dener. Arka plan Bash, Monitor ve geliştirme sunucuları beklenmez. Esc bu beklemeyi her zaman durdurur.

Mod açıkken ve devir başlamamışken sistem prompt'una bir bölüm ekler: Claude bağlam büyüdü diye kendi başına devir yapmaz (my-skill-orchestrate/execute'un "uzun sohbet" devri dahil); devri eşikte mod yapar. Mod açıkken modelin kendi başına my-skill-handoff çağırması engellenir; devri eşikte mod yapar. Kapatmak için /devir kapat.

**Eşiğe gelince:**
1. Mod Claude'a turun içinde tek bir talimat verir: elindeki adımı bitir, yeni iş başlatma, devir dosyasını yazdır (`my-skill-handoff auto`; beceri yoksa modun kendi devir talimatı) ve yeni sohbeti aç.
2. Çalışan alt ajanlar bitene kadar sistem yeni alt ajan, Workflow, Task ya da alt ajana mesaj başlatmayı **koda bağlı olarak** reddeder (bu yalnızca talimat değil, araç çağrısı reddedilir). Durum satırında `Devir: N alt ajan bitiyor` görünür.
3. 30 dakika içinde bitmeyen işleri Claude `TaskStop` ile durdurur ve devir dosyasında "Yeniden çalıştır" başlığı altında listeler.
4. Devir dosyası `.workflow/handoff/<oturum-kimliği>.md` yoluna yazılır. Her sohbetin kendi dosyası olduğu için aynı klasördeki sohbetler birbirinin dosyasını ezmez.
5. Claude yeni sohbeti kendisi, tıklamasız ve iç içe (eski sohbetin altında) açar (`start_session`). Eski sohbet açık kalır. `devredildi` kaydı kalıcıdır, uygulamayı yeniden başlatsanız da aynı sohbetten ikinci bir sohbet açılmaz.

**Kapı kapalıysa (Esc, çökme ya da bir bildirim turu):** uygulama, sizin yazmadığınız bir turda yeni sohbet açılmasına izin vermez. Bu durumda mod devir dosyasını yine hazırlatır ve yazı kutusunun üstünde "Devir hazır" şeridi çıkar. Bir sonraki yazdığınız mesaj önce yeni sohbeti açar; mesajınız yeni sohbetin ilk işi olur. Ping, zamanlanmış görev ya da kart yoktur.

Mevcut kurulumunuzda eski sürümden kalan `otomatik-devir-*` zamanlanmış görevleri varsa mod bunları ilk yüklemede bir kez siler (görevlerin çalıştırma sohbetleri arşivlenir; arşivden geri alınabilir) ve eski kayıt anahtarlarını temizler.

| Komut | Ne yapar |
|---|---|
| `/devir` | Durumu gösterir |
| `/devir esik 70` | Eşiği %70 yapar (1-99) |
| `/devir dene 20` | Eşiği yalnızca bu sohbet için %20 yapar (deneme); `/devir dene` yazınca kaldırır |
| `/devir simdi` | Devri hemen başlatır |
| `/devir kapat` / `/devir ac` | Modu kapatır / açar |

v0.x'teki mod ve geçiş komutları v1.0'da kaldırıldı; tek mod otomatik. Eski komutları yazarsanız mod bunu söyleyen bir yanıt verir. Kapatmak için `/devir kapat`.

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

Çıktı, modun hangi işlemleri yaptığını listeler. İki modun listesinde de ağ çağrısı yoktur. ilerleme-cubugu yalnızca proje klasöründeki plan dosyalarını okur, hiçbir dosyaya yazmaz. otomatik-devir devam notunu Claude'a yazdırır (`.workflow/handoff/<oturum-kimliği>.md`); kendisi mod açıkken sistem prompt'una devri kendisinin yönettiğini söyleyen bir bölüm ekler, eşikte Claude'un süren turuna talimat ekler, alt ajan ve Workflow başlatmayı eşikten sonra reddeder ve alt ajanlar ya da Workflow'lar çalışırken turun bitmesini engeller. Yeni sohbeti masaüstü uygulamasının oturum aracıyla (`start_session`) Claude'a açtırır; ilk yüklemede eski sürümün `otomatik-devir-*` zamanlanmış görevlerini siler.

## Bilinen sınırlar

- **otomatik-devir:** Alt komutlar Türkçe harfsiz yazılır: `esik`, `simdi` (`eşik` çalışmaz). Yeni sohbet yalnızca sizin yazdığınız bir turda tıklamasız açılabilir; Esc, çökme ya da bildirim turunda devir hazırlanır, "Devir hazır" şeridi çıkar ve sonraki mesajınız yeni sohbeti açar. Tur sonu koruması yalnızca alt ajanları ve Workflow'ları bekler; arka plan Bash, Monitor ve geliştirme sunucuları beklenmez. 30 dakikada bitmeyen alt ajanlar durdurulur ve devir dosyasında "Yeniden çalıştır" olarak kalır. Eşik tüm açık sohbetleri etkiler; tek bir sohbette denemek için `/devir dene <n>` kullanın.
- **ilerleme-cubugu:** Plan dosyasını editörde elle değiştirirseniz çubuğun güncellenmesi birkaç saniye sürebilir. Plan çubuğu yalnız o dosyalardan bahseden sohbette görünür. İş bitince çubuk kısa bir süre "✓ Tamamlandı" gösterip kaybolur.
- **Yazı kutusunun üstündeki şerit paylaşılır:** iki mod (ve varsa başka modlar) aynı şeride çizer. Başka modun düğmeleri (ör. "Geç / Bekle") her zaman üstte kalır; adım listesi açıkken bile onları ekrandan itmez.

## Geliştirenler için

Her modun testleri `modlar/<mod>/tests/` içinde. Çalıştırmak için mod klasöründe:

```bash
claude plugin test .
```

## Lisans

MIT. Kullanın, değiştirin, paylaşın. Sorun görürseniz bir issue açın ya da Skool topluluğunda yazın.
