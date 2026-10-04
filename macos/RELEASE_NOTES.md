# Flow2Short Studio for macOS 1.0.0

نسخهٔ مستقل مخصوص مک‌بوک و سایر مک‌های Apple Silicon اکنون در دسترس است.

- نیازمندی: M1 یا جدیدتر، macOS 13 یا جدیدتر؛ این بسته برای مک Intel نیست.
- دانلود: `Flow2Short-Mac.zip` را باز کنید و `Flow2Short Studio.app` را به Applications منتقل کنید.
- بدون نیاز به Python، Go، Node، مرورگر یا ترمینال برای اجرای اپ.
- پنجره، منوها و پنجره‌های انتخاب و ذخیرهٔ فایل بومی macOS، همراه رابط فارسی در WebKit.
- رندر محلی با FFmpeg بومی؛ برش، ترنزیشن، صدا و زیرنویس در فایل MP4.
- میان‌برها: ⌘I ورود کلیپ، ⌘O بازکردن پروژه، ⌘S ذخیرهٔ پروژه و ⇧⌘E خروجی.
- امکانات Google Gemini همچنان به اینترنت و کلید API خود کاربر نیاز دارند.

امضا ad-hoc است و بسته notarized نیست. در صورت مسدودشدن اجرا، منبع دانلود را بررسی کنید و از System Settings → Privacy & Security → Open Anyway استفاده کنید.

[سورس نسخهٔ مک](https://github.com/Grandudelife/Flow2Short/tree/macos-native) · [راهنمای کامل](https://github.com/Grandudelife/Flow2Short/blob/macos-native/macos/README.md)

تست‌های خودکار شامل سرویس Go با race detector، تست‌های Python، پیش‌نمایش، رندر واقعی 720×1280 همراه صدا/ترنزیشن/زیرنویس و لغو رندر هستند. انتخاب و ذخیرهٔ فایل و خروجی 1080×1920 نیز روی مک‌بوک توسعه‌دهنده آزمایش شده‌اند.
