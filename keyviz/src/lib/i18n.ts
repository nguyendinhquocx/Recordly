// Minimal i18n for the Keyviz settings UI (Recordly sidecar integration).
//
// The language comes from the `lang` query param of the hash route
// (e.g. index.html#/settings?lang=vi, set by the sidecar `--mode=settings`).
// Standalone builds get no param and default to English.
//
// Physical key names (Ctrl, Shift, AA/Aa/aa, preset names like PBT) are
// intentionally never translated. Layout and styles are untouched.

export type Lang = "en" | "vi";

function detectLang(): Lang {
    if (typeof window === "undefined") return "en";
    const hash = window.location.hash ?? "";
    const query = hash.includes("?")
        ? hash.slice(hash.indexOf("?") + 1)
        : window.location.search;
    try {
        return new URLSearchParams(query).get("lang") === "vi" ? "vi" : "en";
    } catch {
        return "en";
    }
}

let lang: Lang = detectLang();

export function getLang(): Lang {
    return lang;
}

type Dict = Record<string, string>;

const en: Dict = {
    // settings.tsx sidebar
    "settings.tab.general": "General",
    "settings.tab.appearance": "Appearance",
    "settings.tab.keycap": "Keycap",
    "settings.tab.mouse": "Mouse",
    "settings.tab.about": "About",

    // general.tsx
    "general.title": "General",
    "general.filter": "Filter",
    "general.filter.desc.none": "No filter applied, all keys will be shown.",
    "general.filter.desc.modifiers": "Only modifier keys will be shown.",
    "general.filter.desc.custom": "Custom filter applied, {count} keys allowed.",
    "general.filter.custom.title": "Custom Filter",
    "general.filter.custom.desc": "Select which keys to display. Hold down Ctrl to toggle related keys.",
    "general.filter.off": "Off",
    "general.filter.off.aria": "No Filter",
    "general.filter.hotkeys": "Hotkeys",
    "general.filter.hotkeys.aria": "Modifiers Only",
    "general.filter.custom": "Custom",
    "general.filter.custom.aria": "Custom Filter",
    "general.history": "History",
    "general.history.desc": "Keep previously pressed keystrokes in the view",
    "general.direction": "Direction",
    "general.direction.row": "Row",
    "general.direction.row.aria": "Horizontal",
    "general.direction.column": "Column",
    "general.direction.column.aria": "Vertical",
    "general.maxCount": "Max Count",
    "general.toggleShortcut": "Toggle Shortcut",
    "general.toggleShortcut.desc": "Global shortcut to show/hide the key visualizer, click box to set",

    // appearance.tsx
    "appearance.title": "Appearance",
    "appearance.position": "Position",
    "appearance.display": "Display",
    "appearance.display.desc": "Change monitor/display for the visualisation.",
    "appearance.display.placeholder": "Select Display",
    "appearance.display.fallback": "Display {index}",
    "appearance.alignment": "Alignment",
    "appearance.alignment.desc": "Position of the key visualization on the screen",
    "appearance.margin": "Margin",
    "appearance.margin.desc": "Space from the edge of the screen",
    "appearance.margin.linked.aria": "Margin linked",
    "appearance.duration": "Duration",
    "appearance.duration.desc": "The duration keys stay on screen (in seconds)",
    "appearance.animation": "Animation",
    "appearance.animation.none": "None",
    "appearance.animation.fade": "Fade",
    "appearance.animation.zoom": "Zoom",
    "appearance.animation.float": "Float",
    "appearance.animation.slide": "Slide",
    "appearance.animationSpeed": "Animation Speed",
    "appearance.animationSpeed.desc": "Higher the value, slower the animation",

    // keycap.tsx
    "keycap.title": "Keycap",
    "keycap.preset": "Preset",
    "keycap.preset.minimal": "Minimal",
    "keycap.preset.laptop": "Laptop",
    "keycap.preset.lowprofile": "Lowprofile",
    "keycap.preset.pbt": "PBT",
    "keycap.import": "Import",
    "keycap.export": "Export",
    "keycap.text": "Text",
    "keycap.text.size": "Size",
    "keycap.text.variant": "Variant",
    "keycap.text.variant.full": "Full Text",
    "keycap.text.variant.short": "Short Text",
    "keycap.text.variant.icon": "Icon Only",
    "keycap.text.caps": "Text Cap",
    "keycap.text.color": "Text Color",
    "keycap.modifier.color": "Modifier Color",
    "keycap.layout": "Layout",
    "keycap.layout.icon": "Icon",
    "keycap.layout.alignment": "Alignment",
    "keycap.layout.symbol": "Symbol",
    "keycap.layout.symbol.desc": "Display symbol characters like !, @, #, etc.",
    "keycap.layout.pressCount": "Press Count",
    "keycap.layout.pressCount.desc": "Display the number of times a key has been pressed.",
    "keycap.color": "Color",
    "keycap.color.highlightModifier": "Highlight Modifier",
    "keycap.color.highlightModifier.desc": "Use different color for modifier keys",
    "keycap.color.gradient": "Gradient",
    "keycap.color.normal": "Normal",
    "keycap.color.modifier": "Modifier",
    "keycap.color.primary": "Primary",
    "keycap.color.secondary": "Secondary",
    "keycap.color.normalColor": "Normal Color",
    "keycap.color.modifierColor": "Modifier Color",
    "keycap.border": "Border",
    "keycap.border.enable": "Enable",
    "keycap.border.width": "Width",
    "keycap.border.color": "Color",
    "keycap.border.radius": "Radius",
    "keycap.background": "Background",
    "keycap.background.enable": "Enable",
    "keycap.background.color": "Color",

    // mouse.tsx
    "mouse.title": "Mouse",
    "mouse.cursorHighlight": "Cursor Highlight",
    "mouse.showClicks": "Show Clicks",
    "mouse.showClicks.desc": "Animate a ring upon mouse press",
    "mouse.size": "Size",
    "mouse.color": "Color",
    "mouse.alwaysHighlight": "Always Highlight",
    "mouse.alwaysHighlight.desc": "Permanently show the ring around the cursor",
    "mouse.indicator": "Button Indicator",
    "mouse.showIndicator": "Show Indicator",
    "mouse.showIndicator.desc": "Display button and scroll icons next to the cursor",
    "mouse.keepIndicator": "Keep Indicator",
    "mouse.keepIndicator.desc": "Permanently show the icon beside the cursor",
    "mouse.offset": "Offset",
    "mouse.offset.desc": "Space from the cursor to the indicator",
    "mouse.offset.linked.aria": "Offset linked",
    "mouse.event": "Event",
    "mouse.dragThreshold": "Drag Threshold",
    "mouse.dragThreshold.desc": "Minimum distance in pixels to show Drag event",

    // about.tsx
    "about.newVersion": "New version available: v{version}",
    "about.view": "View",
    "about.latest": "You are using the latest version.",
    "about.checkFailed": "Failed to check for updates.",
    "about.upgrade": "Upgrade to Pro",
    "about.upgrade.desc": "Love Keyviz? Support its growth and unlock more with Pro.",
    "about.goPro": "Go Pro",
    "about.checkUpdates": "Check for updates",
    "about.check": "Check",
    "about.updateAvailable": "Update Available",
    "about.openSource": "Open Source",
    "about.openSource.desc": "Review the source code on GitHub, sponsor, star the project, or contribute to its development.",
    "about.discord": "Discord",
    "about.discord.desc": "Join our Discord community.",
};

const vi: Dict = {
    // settings.tsx sidebar
    "settings.tab.general": "Chung",
    "settings.tab.appearance": "Giao diện",
    "settings.tab.keycap": "Kiểu phím",
    "settings.tab.mouse": "Chuột",
    "settings.tab.about": "Giới thiệu",

    // general.tsx
    "general.title": "Chung",
    "general.filter": "Bộ lọc",
    "general.filter.desc.none": "Không có bộ lọc nào, mọi phím bấm đều được hiển thị.",
    "general.filter.desc.modifiers": "Chỉ hiển thị các phím bổ trợ (modifier).",
    "general.filter.desc.custom": "Đang dùng bộ lọc tùy chỉnh, cho phép {count} phím.",
    "general.filter.custom.title": "Bộ lọc tùy chỉnh",
    "general.filter.custom.desc": "Chọn phím muốn hiển thị. Giữ Ctrl để bật/tắt các phím liên quan.",
    "general.filter.off": "Tắt",
    "general.filter.off.aria": "Không lọc",
    "general.filter.hotkeys": "Phím tắt",
    "general.filter.hotkeys.aria": "Chỉ phím bổ trợ",
    "general.filter.custom": "Tùy chỉnh",
    "general.filter.custom.aria": "Bộ lọc tùy chỉnh",
    "general.history": "Lịch sử",
    "general.history.desc": "Giữ lại các phím vừa bấm trên màn hình",
    "general.direction": "Hướng",
    "general.direction.row": "Hàng ngang",
    "general.direction.row.aria": "Ngang",
    "general.direction.column": "Hàng dọc",
    "general.direction.column.aria": "Dọc",
    "general.maxCount": "Số phím tối đa",
    "general.toggleShortcut": "Phím tắt bật/tắt",
    "general.toggleShortcut.desc": "Phím tắt toàn cục để bật/tắt bảng phím, bấm vào ô để cài đặt",

    // appearance.tsx
    "appearance.title": "Giao diện",
    "appearance.position": "Vị trí",
    "appearance.display": "Màn hình",
    "appearance.display.desc": "Chọn màn hình hiển thị hiệu ứng phím.",
    "appearance.display.placeholder": "Chọn màn hình",
    "appearance.display.fallback": "Màn hình {index}",
    "appearance.alignment": "Căn lề",
    "appearance.alignment.desc": "Vị trí của bảng phím trên màn hình",
    "appearance.margin": "Lề",
    "appearance.margin.desc": "Khoảng cách từ mép màn hình",
    "appearance.margin.linked.aria": "Liên kết hai lề",
    "appearance.duration": "Thời lượng",
    "appearance.duration.desc": "Thời gian phím hiển thị trên màn hình (tính bằng giây)",
    "appearance.animation": "Hiệu ứng",
    "appearance.animation.none": "Không",
    "appearance.animation.fade": "Mờ dần",
    "appearance.animation.zoom": "Phóng to",
    "appearance.animation.float": "Trôi",
    "appearance.animation.slide": "Trượt",
    "appearance.animationSpeed": "Tốc độ hiệu ứng",
    "appearance.animationSpeed.desc": "Giá trị càng cao, hiệu ứng càng chậm",

    // keycap.tsx
    "keycap.title": "Kiểu phím",
    "keycap.preset": "Mẫu có sẵn",
    "keycap.preset.minimal": "Tối giản",
    "keycap.preset.laptop": "Laptop",
    "keycap.preset.lowprofile": "Lowprofile",
    "keycap.preset.pbt": "PBT",
    "keycap.import": "Nhập",
    "keycap.export": "Xuất",
    "keycap.text": "Chữ",
    "keycap.text.size": "Cỡ chữ",
    "keycap.text.variant": "Kiểu hiển thị",
    "keycap.text.variant.full": "Chữ đầy đủ",
    "keycap.text.variant.short": "Chữ ngắn",
    "keycap.text.variant.icon": "Chỉ biểu tượng",
    "keycap.text.caps": "Chữ hoa",
    "keycap.text.color": "Màu chữ",
    "keycap.modifier.color": "Màu phím bổ trợ",
    "keycap.layout": "Bố cục",
    "keycap.layout.icon": "Biểu tượng",
    "keycap.layout.alignment": "Căn lề",
    "keycap.layout.symbol": "Ký tự đặc biệt",
    "keycap.layout.symbol.desc": "Hiển thị các ký tự như !, @, #, v.v.",
    "keycap.layout.pressCount": "Số lần nhấn",
    "keycap.layout.pressCount.desc": "Hiển thị số lần một phím đã được nhấn.",
    "keycap.color": "Màu sắc",
    "keycap.color.highlightModifier": "Làm nổi bật phím bổ trợ",
    "keycap.color.highlightModifier.desc": "Dùng màu riêng cho các phím bổ trợ",
    "keycap.color.gradient": "Chuyển màu",
    "keycap.color.normal": "Thường",
    "keycap.color.modifier": "Bổ trợ",
    "keycap.color.primary": "Chính",
    "keycap.color.secondary": "Phụ",
    "keycap.color.normalColor": "Màu thường",
    "keycap.color.modifierColor": "Màu phím bổ trợ",
    "keycap.border": "Viền",
    "keycap.border.enable": "Bật",
    "keycap.border.width": "Độ dày",
    "keycap.border.color": "Màu",
    "keycap.border.radius": "Độ bo tròn",
    "keycap.background": "Nền",
    "keycap.background.enable": "Bật",
    "keycap.background.color": "Màu",

    // mouse.tsx
    "mouse.title": "Chuột",
    "mouse.cursorHighlight": "Nổi bật con trỏ",
    "mouse.showClicks": "Hiện cú nhấp",
    "mouse.showClicks.desc": "Tạo hiệu ứng vòng tròn khi nhấp chuột",
    "mouse.size": "Kích thước",
    "mouse.color": "Màu",
    "mouse.alwaysHighlight": "Luôn nổi bật",
    "mouse.alwaysHighlight.desc": "Luôn hiển thị vòng tròn quanh con trỏ",
    "mouse.indicator": "Chỉ báo nút chuột",
    "mouse.showIndicator": "Hiện chỉ báo",
    "mouse.showIndicator.desc": "Hiển thị biểu tượng nút bấm và cuộn cạnh con trỏ",
    "mouse.keepIndicator": "Giữ chỉ báo",
    "mouse.keepIndicator.desc": "Luôn hiển thị biểu tượng cạnh con trỏ",
    "mouse.offset": "Độ lệch",
    "mouse.offset.desc": "Khoảng cách từ con trỏ đến chỉ báo",
    "mouse.offset.linked.aria": "Liên kết hai hướng lệch",
    "mouse.event": "Sự kiện",
    "mouse.dragThreshold": "Ngưỡng kéo chuột",
    "mouse.dragThreshold.desc": "Khoảng cách tối thiểu (pixel) để hiển thị sự kiện kéo",

    // about.tsx
    "about.newVersion": "Có phiên bản mới: v{version}",
    "about.view": "Xem",
    "about.latest": "Bạn đang dùng phiên bản mới nhất.",
    "about.checkFailed": "Không thể kiểm tra cập nhật.",
    "about.upgrade": "Nâng cấp lên Pro",
    "about.upgrade.desc": "Thích Keyviz? Ủng hộ dự án phát triển và mở khóa thêm tính năng với Pro.",
    "about.goPro": "Lên Pro",
    "about.checkUpdates": "Kiểm tra cập nhật",
    "about.check": "Kiểm tra",
    "about.updateAvailable": "Có bản cập nhật",
    "about.openSource": "Mã nguồn mở",
    "about.openSource.desc": "Xem mã nguồn trên GitHub, tài trợ, đánh dấu sao hoặc đóng góp vào sự phát triển của dự án.",
    "about.discord": "Discord",
    "about.discord.desc": "Tham gia cộng đồng Discord của chúng tôi.",
};

export function t(key: string, vars?: Record<string, string | number>): string {
    let text = (lang === "vi" ? vi[key] : undefined) ?? en[key] ?? key;
    if (vars) {
        for (const [name, value] of Object.entries(vars)) {
            text = text.split(`{${name}}`).join(String(value));
        }
    }
    return text;
}
