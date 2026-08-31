/** 像素风字母 K 图标（4x6 网格，上下对称，竖线不超出斜臂） */
export default function PixelK() {
  const cells: Array<[number, number]> = [
    [0, 0], [3, 0],
    [0, 1], [2, 1],
    [0, 2], [1, 2],
    [0, 3], [1, 3],
    [0, 4], [2, 4],
    [0, 5], [3, 5],
  ]
  return (
    <svg
      className="brand-icon"
      width="16"
      height="24"
      viewBox="0 0 4 6"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" />
      ))}
    </svg>
  )
}
