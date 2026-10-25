---
description: Otonom zincir başlat (otomatik-devir orkestra modu); bu sohbet ana sohbet olur, işi alt sohbetler yapar
argument-hint: <görev>
disable-model-invocation: true
---
<!-- otomatik-devir:otonom -->
Bu sohbet otonom bir zincirin ANA sohbeti (otomatik-devir orkestra modu).

- Burada gerçek iş yapma: kod düzenleme, dosya yazma yok; işi yapan bir alt ajan da başlatma. İşi yönetilen alt sohbetler yapar.
- Aşağıdaki görevi (ya da kullanıcının talimatlarından uyarlanmış kısa bir brifi) alt sohbet 1'in prompt'u olarak gönder: `mcp__ccd_session__start_session` aracını bir kez çağır, initiation "user_asked", context "fresh". Araç yüklü değilse önce ToolSearch ile yükle.
- Sonra otomatik-devir'in notlarına uy: alt sohbet çalışırken bekle, hazır olunca sıradaki alt sohbeti aç, zincir bitince kullanıcıya özet yaz. Mod zincirin bittiğini söyleyene kadar devam et.

Görev: $ARGUMENTS
