# teach-live-draw —— `<draw>` 运行时：模型给语义，代码给几何

> 2026-09-11。为什么存在：模型是在预测 token，不是在计算——它写坐标时看不见图，切线差 3° 它不知道。
> 数学课上一条不垂直于半径的「切线」是错误不是瑕疵。通用解法不是给几个原语堵漏，而是**代码即意图**：
> 老师（模型）写一段 JS 表达「过 P 作圆 O 的切线」，这里的确定性运行时算出并渲染——语言是通用的
> （没有原语就自己算：正十七边形写循环），库只是省力气。决策记录：`docs/TEACH_TUTOR_ENGINE.md` §12.4。
> 消费方：`src/components/teach-live/draw/`（Worker 沙箱 + DrawBlock）。prompt 里的 API 说明：
> `src/lib/prompts/teach-live-prompt.ts` 的 `DRAW_API`（改 API 必须同步改那段——模型只看得见 prompt）。

## 数据流

```
<draw id="fig">脚本</draw>  ─►  runtime.runDraw(chunks, { params, transform?, fromChunk? })
   <draw into="fig">…</draw>        │  chunks 拼成一个函数体执行（into 段与首段同一作用域：A、B、圆 c 直接用）
                                    │  new Function(...apiNames, body)：API 以参数注入，脚本只看得见它们
                                    ▼
                              Scene（drawables 列表，数学坐标）
                                    │
                              render(scene, { idPrefix, transform, fromChunk })
                                    ▼
              { markup, viewBox, transform, params, names }   →   前端 ProgressiveSvg 逐笔长出
```

- **纯函数、零 DOM**：可在 Worker 里跑，也可在单测里跑。安全边界（超时 / 无网络）由调用方（`draw-worker.ts`）负责；本模块只把语法 / 运行错误变成结构化结果，永不抛出。
- **into 追加同布局**：首块算出的 `transform`（缩放 / 平移）传回给后续 chunk，只输出 `fromChunk` 之后的新 drawable；越界时 viewBox 外扩（图不会因为追加而跳动）。
- **非严格模式执行**：老师偶发 `l = lineThrough(P, 100)` 忘了 const，严格模式会 ReferenceError；宽松模式下成了隐式全局，跑完把新冒出来的全局删掉。`point(2, 3, 'Q')` 会把合法标识符的点名暴露成变量，老师常写完点就直接用 `Q`。

## 文件

| 文件 | 职责 |
|---|---|
| `geometry.ts` | 几何内核：点 / 线（line·ray·segment 共用两点表示）/ 圆；`angleOf` `foot` `bisector` `reflect` `intersectLines` `intersectLineCircle` `intersectCircles` `tangentAt`（过切点垂直半径）`tangentPoints`（外点切线：解直角三角形）`circumcircle` `incircle` `centroid` `polygonArea` `squareOn`（勾股：边上外侧正方形）`regularPolygon` `distToSegment`。一切都是计算，不是画 |
| `analysis.ts` | 分析内核：`toFn`（字符串表达式走 `lib/utils/safe-math`，无 eval）、`sample`、`derivative` / `secondDerivative`（中心差分）、`integral`（Simpson）、`roots`（扫描 + 二分）、`extrema`、`tangentSegment` / `normalSegment`、`sampleParametric` / `samplePolar`、`intersections` |
| `scene.ts` | 脚本可见的 API（`createApi`）与场景图（`Scene`）：对象类（point / segment / line / ray / circle / arc / polygon / angle / label / text / arrow / vector）调用即登记 drawable；构造类（midpoint / intersect / perpendicular / parallel / perpBisector / foot / bisector / tangentAt / tangentsFrom / onCircle / polar / rotate / reflect / translate / lineThrough / circumcircle / incircle / squareOn / regularPolygon / centroid）返回数学对象，线与圆算出来就画（`{ hidden: true }` 只算不画）；分析类（curve / parametric / polarCurve / axes / view / size / tangentLine / normalLine / area / roots / extrema / intersections / derivative / integral）；动画与交互（`trace` 沿线运动——路径就是形状本身，永不偏离；`animate` 属性动画；`param` 登记滑块）。色板 `PALETTE`（与 prompt / tokens 同源）。直角自动检测（89.5°–90.5° 画小方块） |
| `render.ts` | 场景图 → SVG 标记：`fitTransform`（几何图保形铺满；带 `axes` 的函数图 x / y 各自铺满——y = x² 从来不是等比画的）、直线 / 射线裁剪到画布、标签避让（点标签沿远离重心方向放，占位盒碰撞就换方向）、角标 / 直角标、箭头 marker、面积填充、坐标轴与网格（`data-draw="fade"` 让前端整体淡入）、`trace` → `<mpath>` 引用形状的 `<path>`；所有可当运动路径的形状都渲染成 `<path>`；元素 id = `${idPrefix}${localId}` + `data-name`（激光笔 `point at="fig#AB"` 靠它命中） |
| `runtime.ts` | `runDraw(chunks, options)`：`cleanScript`（剥 ```js 围栏 / `<script>`）→ 注入 API 执行 → render；`console.log` 收进 `log` 返回。**能画多少画多少**：运行期报错（未定义变量等）时把报错前登记的对象照常渲染，结果 `ok: true` 带 `error` / `errorChunk`；只有语法错误（一个对象都没登记）才 `ok: false` |
| `__tests__/draw-runtime.test.ts` | 严谨性单测：切线垂直半径、外点切线真的相切、三种交点、外接圆 / 内切圆、squareOn 朝向；脚本 → SVG（稳定 id、直角标、into 复用 transform、切线斜率、面积 / 根 / 极值、滑块、结构化错误、全局遮蔽）；`{{ }}` 内联计算 |

## 与其它块的关系

- `<plot>`（`components/teach-live/plot-dsl.ts`）是「只画一两条曲线」的短写法，共用 `safe-math`；要切线 / 面积 / 动点 / 滑块用 `<draw>`。
- `<svg>` 留给自由示意图（梯子、船、细胞）；`<anim>` 留给不涉精确几何的过程动画。prompt 的分工说明在 `PROTOCOL` 段。
- 口播 / 要点 / 公式里的 `{{ 3^2 + 4^2 }}` 由服务端 `teach-live/inline-math-stream.ts` 用同一个 `safe-math` 算好再发出（TTS、字幕、记录、模型历史看到的都是数字）。

## 模型笔误怎么吸收（2026-09-11 实测阿波罗尼斯圆那节：4 段脚本 2 段有 `circle(O,3)` 忘接 `const c` / 引用未定义的占位变量）

1. **部分渲染**：报错前算好的对象照常上板（见 runtime 行）。
2. **自愈**：`components/teach-live/draw/DrawBlock.tsx` 在段闭合时（不等揭示）就预跑；报错 → `POST /api/teach/threads/[id]/draw-fix`（`services/teach-live/draw-repair.ts`：只给模型 API 说明 + 全部段 + 错误，要它只输出修正后的那一段，服务端复跑验证）→ 替换该段重算。几百 token、1–2 秒，藏在老师念前面几句话的时间里，学生看不到过程。每段只试一次、每线程限 40 次。
3. **最后兜底**：修不好才显示「这张图老师没画出来」，并经 `onIssue` 在学生下次开口时以 `boardNote` 告诉老师。
4. **误用给能修的错误，不给 NaN**：`segment / line / circle / polygon / arrow` 的点参数经 `expectPt` 校验，不是点就抛 `TypeError: arrow() 的 终点 需要一个点（{x, y}），收到 number`——这句话正好能让自愈把脚本改对；`arrow` 同时接受 `(A, B)` 与 `(A, dx, dy)`（NS 方程那节老师把两种签名混用，24 个箭头全是 `LNaN NaN`）；render 的 `emit` 最后再兜一层：含 NaN 的元素不上板。

## 边界

- 脚本超时（死循环）由 `draw-runtime-client.ts` 2s 终止并重建 Worker。
- 一张图建议 ≤ 40 个对象（prompt 约定）；标签避让是占位盒启发式，极密的图仍可能重叠。
- 不做符号计算：导数 / 积分 / 求根都是数值的，显示精度足够，不要拿它证明恒等式。
