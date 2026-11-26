# UI contract: SF-126

| Surface | Element | Attribute | Double-click result |
|---|---|---|---|
| Deals board | card | `data-page="/deals/<id>"` | deal page |
| Deal list | `tr` | `data-page="/deals/<id>"` | deal page |
| People list | `tr` | `data-page="/people/<id>"` | person page |
| Organisations list | `tr` | `data-page="/organisations/<id>"` | organisation page |

`pageToOpen(target)` returns the address, or null when the target is in a real link (name, organisation, person) or
has no `data-page` ancestor, or the address does not match `^/(deals|people|organisations)/\d+$`.
Single click, drag, keyboard paths and texts: unchanged.
