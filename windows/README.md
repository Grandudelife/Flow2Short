# Flow2Short Studio for Windows

نسخهٔ مستقل ویندوز در شاخهٔ [`windows-native`](https://github.com/Grandudelife/Flow2Short/tree/windows-native) در دسترس است.
[دانلود EXE آماده و فایل بررسی SHA-256](https://github.com/Grandudelife/Flow2Short/releases/tag/windows-v1.0.0).

## اجرا

فایل **Flow2Short-Windows.exe** را دانلود و باز کنید؛ این نسخه یک EXE قابل حمل است و
به نصب Python، Go، Node، .NET یا بازکردن مرورگر و ترمینال نیاز ندارد.
نیازمندی: **ویندوز ۱۱ یا ویندوز ۱۰ نسخهٔ ۱۸۰۹ و جدیدتر، ۶۴بیتی با پردازندهٔ Intel/AMD (x64)**.
مبنای تست خودکار Windows Server 2022 است؛ نسخهٔ ARM64 و ویندوز ۳۲بیتی در این بسته ارائه نمی‌شوند.

**Microsoft Edge WebView2 Runtime** باید نصب باشد. اگر موجود نباشد، اپ لینک
[دانلود رسمی مایکروسافت](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
را پیشنهاد می‌دهد؛ پس از نصب Runtime اپ را دوباره باز کنید.
اجرای معمول به دسترسی Administrator نیاز ندارد. EXE فعلاً امضای تجاری Authenticode ندارد.

رابط فارسی قبلی داخل WebView2 نمایش داده می‌شود؛ پنجره، منوها و انتخاب/ذخیرهٔ فایل
بومی ویندوز هستند. رندر محلی با FFmpeg بومی انجام می‌شود و امکانات Gemini همچنان
به اینترنت و کلید API خود کاربر نیاز دارند. تصویر و آیکون فعلی اپ حفظ شده‌اند.

میان‌برها: Ctrl+I ورود کلیپ، Ctrl+O بازکردن Recipe، Ctrl+S ذخیرهٔ Recipe،
Ctrl+Shift+E ساخت ویدئو و Ctrl+, تنظیمات. هنگام خروج در صورت وجود پروژه یا رندر
باز، پیام تأیید نمایش داده می‌شود. رسانه‌ها داخل فایل Recipe ذخیره نمی‌شوند.

در نخستین اجرا فایل‌های داخلی در `%LOCALAPPDATA%\Flow2Short\Runtime` باز می‌شوند؛
تنظیمات و ذخیرهٔ خودکار در `%LOCALAPPDATA%\Flow2Short` می‌مانند. سرور فقط روی
127.0.0.1 و درگاه تصادفی اجرا می‌شود و عملیات داخلی به کلید تصادفی همان اجرا نیاز دارند.
با خروج، موتور و فایل‌های موقت پردازش بسته و پاک می‌شوند.
این نسخه مانند مخزن، خصوصی است و دانلود آن به دسترسی به مخزن نیاز دارد.

## ساخت از سورس روی ویندوز

نیازمندی‌های توسعه: .NET SDK 10، Go، PowerShell 7 و اینترنت برای دریافت وابستگی‌ها.

```powershell
pwsh -File windows/build.ps1 -Destination C:\Flow2Short-build
pwsh -File windows/test.ps1 -Executable C:\Flow2Short-build\Flow2Short-Windows.exe -Reports C:\Flow2Short-test
```

اسکریپت FFmpeg را از نسخهٔ مشخص با کنترل SHA-256 دریافت می‌کند و فایل‌های داخلی
و .NET Runtime را داخل EXE قرار می‌دهد. WebView2 Runtime جداگانه نصب می‌شود.

[Workflow ساخت ویندوز](https://github.com/Grandudelife/Flow2Short/actions/workflows/windows.yml)
تست‌های Go، Python، پیش‌نمایش، رندر واقعی با ترنزیشن و زیرنویس، لغو رندر و
اجرای خود EXE در WebView2 را بررسی می‌کند. نخستین اجرای موفق نسخهٔ ۱.۰.۰ را در
Releases منتشر می‌کند؛ اجرای دوباره فایل‌های Release موجود را تغییر نمی‌دهد.
