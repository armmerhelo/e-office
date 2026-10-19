# Shared E-Office buttons

Preview: `button-style.html`. Styles: `assets/ui-buttons.css`.

## Usage

```html
<button type="submit" class="eo-btn eo-btn--primary">บันทึกข้อมูล</button>
<button type="button" class="eo-btn eo-btn--secondary">ยกเลิก</button>
<button type="button" class="eo-btn eo-btn--soft eo-btn--sm">แก้ไข</button>
<button type="button" class="eo-btn eo-btn--danger-text eo-btn--sm">ลบ</button>
```

| Variant | Purpose |
| --- | --- |
| `eo-btn--primary` | Main action: save, create, submit or confirm |
| `eo-btn--secondary` | Cancel, refresh, print, download or back |
| `eo-btn--soft` | Emphasized secondary action or selected filter/page |
| `eo-btn--ghost` | Quiet toolbar action or clear filters |
| `eo-btn--danger` | Destructive confirmation |
| `eo-btn--danger-text` | Destructive action in a list |

- Standard: 44px minimum height, 14px/500 text, 8px radius.
- `eo-btn--sm`: 36px minimum height with 13px text; 44px on mobile/narrow module containers.
- `eo-btn--icon`: 44px square. Always provide an accessible name (`aria-label`).
- Use `disabled` to block duplicate submissions. `aria-busy="true"` provides the busy cursor; each form owns its loading text and submission lifecycle.
- Use `aria-pressed` for toggle filters and `aria-current="page"` for pagination.
- Keep a single primary action per action group. Use green for success status and amber for warnings rather than ordinary edit/download actions.

## Loading and compatibility

Load the stylesheet **after page styles** in the document head. Module templates include it explicitly: `assets/module-router.js` reads their head stylesheets into each Shadow DOM. A stylesheet in the main document alone cannot style module buttons. The standalone signing and report pages also include it directly.

Existing semantic classes (`btn`, `booking-button`, `button-primary` within orders, maintenance submit/save/manage buttons, etc.) are supported as migration aliases. New controls should use `eo-btn` variants. Dynamic template buttons must use the same classes; do not determine a button's meaning from its text or change classes through a global observer.

Main-page PHP uses `filemtime` cache versions. Bump the `ui-buttons.css?v=...` version in static templates when updating the shared stylesheet for deployment.

The stylesheet does not change event handlers, form associations, authorization, or the current disabled/hidden lifecycle. Native `hidden`, Tailwind's `hidden`, and inline display controls remain authoritative.
