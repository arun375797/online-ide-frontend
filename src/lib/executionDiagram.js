export function collectArrayShapes(events) {
  const shapes = new Map();
  for (const event of events) {
    for (const [name, { value }] of Object.entries(event.variables)) {
      if (!Array.isArray(value)) continue;
      const matrix = value.some(Array.isArray);
      const previous = shapes.get(name);
      shapes.set(name, {
        name,
        matrix: matrix || previous?.matrix || false,
        rows: Math.max(previous?.rows || 1, matrix ? value.length : 1),
        columns: Math.max(
          previous?.columns || 0,
          matrix
            ? Math.max(
                0,
                ...value.map((row) => (Array.isArray(row) ? row.length : 0)),
              )
            : value.length,
        ),
      });
    }
  }
  return [...shapes.values()];
}

export function samePath(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => String(value) === String(right[index]))
  );
}

export function valueAtPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

export function cellState(name, path, step, previousVariables) {
  const entry = step?.variables?.[name];
  const value = valueAtPath(entry?.value, path);
  const previous = valueAtPath(previousVariables?.[name]?.value, path);
  let parent = entry?.value;
  const exists = path.every((key) => {
    if (parent == null || !Object.hasOwn(parent, key)) return false;
    parent = parent[key];
    return true;
  });
  const write = step?.write;
  const written = write?.name === name && samePath(write.path, path);
  const read = step?.reads?.some(
    (item) =>
      item.name === name &&
      item.path.length <= path.length &&
      samePath(item.path, path.slice(0, item.path.length)),
  );
  return {
    value,
    previous,
    exists,
    written,
    read,
    changed:
      Boolean(entry) &&
      Boolean(previousVariables?.[name]) &&
      JSON.stringify(value) !== JSON.stringify(previous),
  };
}

export function focusedCell(step, shapes) {
  const access = step?.write?.path?.every((key) =>
    Number.isInteger(Number(key)),
  )
    ? step.write
    : step?.reads?.find((read) =>
        read.path.every((key) => Number.isInteger(Number(key))),
      );
  if (access) {
    const shape = shapes.find(({ name }) => name === access.name);
    return {
      name: access.name,
      row: shape?.matrix ? Number(access.path[0]) : 0,
      column: Number(access.path[shape?.matrix ? 1 : 0] ?? 0),
    };
  }
  const indexes =
    step?.loops
      ?.filter((loop) => Number.isInteger(loop.indexValue))
      .map((loop) => loop.indexValue) || [];
  if (!indexes.length) return { row: -1, column: -1 };
  return {
    row:
      shapes.some((shape) => shape.matrix) && indexes.length > 1
        ? indexes[0]
        : 0,
    column: indexes.at(-1) || 0,
  };
}
