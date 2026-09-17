# Drag Range Refinement

## Contract

`cursor.drag.setRange` accepts a boolean or a callback.

| Value | Result |
| --- | --- |
| `true` | Apply the original drag bounds. |
| `false` | Keep the selection and do not change scales. |
| Callback that returns `[min, max]` | Apply the returned bounds. |
| Callback that returns `null` | Cancel the change for that scale. |

`cursor.drag.setScale` remains as a deprecated boolean-only alias. Its callback form never shipped and is not supported.

The callback has this signature:

```ts
(
  self: uPlot,
  scaleKey: string,
  min: number,
  max: number,
) => [min: number, max: number] | null
```

The callback receives ordered `min` and `max` scale coordinates from `posToVal()`.

For ordinal X, these values are continuous index coordinates. uPlot selects the nearest indices after the callback returns.

## Snap drag bounds

This callback snaps X drag bounds to 10-unit boundaries:

```js
const opts = {
  cursor: {
    drag: {
      x: true,
      setRange: (u, scaleKey, min, max) => {
        if (scaleKey != "x")
          return [min, max];

        return [
          Math.floor(min / 10) * 10,
          Math.ceil(max / 10) * 10,
        ];
      },
    },
  },
};
```

## Cancel a scale change

Return `null` to cancel the drag change for one scale:

```js
setRange: (u, scaleKey, min, max) => {
  if (scaleKey == "y" && min < 0)
    return null;

  return [min, max];
},
```

## Scope

Only built-in drag zoom calls this callback.

These operations do not call it:

- Programmatic `u.setScale()` calls.
- Programmatic `u.setRange()` calls.
- Initial scale calculation.
- Automatic `setData()` calculation.
- Redraw maintenance.
- Double-click reset.
- Series visibility updates.
- Derived-scale updates.

uPlot calls the callback once for each independent scale that the drag changes.

An XY drag calls it for X and each active independent Y scale. All accepted results commit in one draw.

Each synchronized chart calls its own callback. Therefore, synchronized charts can use different snapping rules.

## Related scale APIs

`scale.range()` calculates bounds from scan results or parent bounds.

`u.setRange(scaleKey, min, max)` sets concrete bounds and bypasses `scale.range()`.

`u.setScale(scaleKey, limits)` accepts object bounds. Null bounds request calculation.

`hooks.setScale` reports committed scale changes after the update.
