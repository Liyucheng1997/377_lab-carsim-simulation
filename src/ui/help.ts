// 模型说明与使用指南（大面板样式）
import { h } from './dom';
import { PROCEDURES } from '../core/procedures';
import { CHANNELS } from '../core/channels';

export function helpView(): HTMLElement {
  const groups = [...new Set(CHANNELS.filter((c) => !c.hidden).map((c) => c.group))];
  const el = h('div', { class: 'help-inner' });
  el.innerHTML = `
<div class="eyebrow">About</div>
<h1>把 CarSim 搬进浏览器，<span class="hl">点开就能跑</span>。</h1>
<p>VDLab 参照 CarSim、VI-CarRealTime 的建模思路，在浏览器里实现了一套面向<b>操纵稳定性、制动、动力性与平顺性</b>的整车动力学仿真平台。模型以「参数化集总模型 + 查表 / 经验公式」为主，计算比实时快 <b>50–200 倍</b>，适合方案阶段的参数研究、教学和驾驶员在环体验。</p>
<div class="pull">模型不追求面面俱到，而是把影响结论的那几个自由度做对。<span class="src">—— 14 自由度 · 魔术公式轮胎 · 0.5 ms 固定步长</span></div>

<h2><span class="eyebrow">How To</span>使用流程</h2>
<div class="tl-list">
  <div class="tl"><div class="yr">STEP 01</div><h4>挑一辆车，改它的参数</h4><div class="note">在<b>车辆参数</b>页选择内置车型，或「复制为新车型」后修改车身、悬架、轮胎、动力总成、制动、转向、空气动力学与主动安全参数。右侧实时给出偏频、侧倾梯度、不足转向度和轮胎 / 发动机 / 减振器特性曲线。</div></div>
  <div class="tl"><div class="yr">STEP 02</div><h4>选一个标准工况</h4><div class="note">在<b>试验仿真</b>页选择试验工况并设置车速、转角、路面附着系数等参数，点「运行仿真」（Ctrl + Enter）。</div></div>
  <div class="tl"><div class="yr">STEP 03</div><h4>看动画、看曲线、看指标</h4><div class="note">三维动画回放可切换跟随 / 自由 / 侧视 / 俯视 / 驾驶员视角并显示轮胎力矢量；6 张曲线的通道可以随意换；评价指标按对应标准计算并给出 通过 / 未通过。</div></div>
  <div class="tl"><div class="yr">STEP 04</div><h4>多方案对比</h4><div class="note">在结果列表勾选「对比」，不同车型或参数的结果会曲线叠加、指标并列，动画里出现半透明对比车。结果可导出 CSV。</div></div>
  <div class="tl now"><div class="yr">STEP 05</div><h4>亲自开一圈</h4><div class="note"><b>实时驾驶</b>页用键盘、游戏手柄或方向盘驾驶（驾驶员在环），过程可以记录下来存为仿真结果。</div></div>
</div>

<h2><span class="eyebrow">Model</span>坐标系与自由度</h2>
<p>采用 ISO 8855 坐标系：x 向前、y 向左、z 向上；横摆逆时针为正，侧倾以左侧抬起为正，俯仰以点头为正。车轮编号沿用 CarSim 习惯：<b>L1 / R1</b> 为前轴左 / 右，<b>L2 / R2</b> 为后轴左 / 右。</p>
<table class="doc">
<tr><th>子系统</th><th>自由度 / 状态</th><th>说明</th></tr>
<tr><td>车身平面运动</td><td>u、v、r</td><td>整车质量的纵向、侧向、横摆运动，含空气阻力与轮胎力</td></tr>
<tr><td>簧上质量</td><td>z<sub>s</sub>、φ、θ</td><td>垂向、侧倾、俯仰；悬架力 + 侧倾中心 / 抗点头几何的顶起力，含侧倾重力矩</td></tr>
<tr><td>非簧载质量</td><td>z<sub>u</sub> × 4</td><td>车轮垂向跳动，轮胎垂向刚度 / 阻尼，可离地</td></tr>
<tr><td>车轮旋转</td><td>ω × 4</td><td>驱动 / 制动 / 滚阻力矩，制动器静摩擦钳位实现抱死</td></tr>
<tr><td>轮胎瞬态</td><td>κ′、tanα′ × 4</td><td>一阶松弛长度模型，低速自动过渡，可静止驻车</td></tr>
<tr><td>动力总成</td><td>档位、闭锁状态</td><td>发动机外特性 + 准静态液力变矩器 + 闭锁离合器 + 自动换挡</td></tr>
</table>
<p>积分采用 0.5 ms 固定步长的半隐式欧拉法，轮胎松弛方程用指数积分（无条件稳定），与实时仿真软件的做法一致。</p>

<h2><span class="eyebrow">Subsystems</span>子系统模型</h2>
<h3>轮胎 · 简化魔术公式</h3>
<p>纯工况 F = D·sin(C·arctan(Bx − E(Bx − arctan Bx)))，D = μ·F<sub>z</sub> 且 μ 随载荷变化；纵滑刚度 ∝ F<sub>z</sub>，侧偏刚度随载荷饱和。联合工况用 MF5.2 风格的削弱函数并以摩擦椭圆限幅；考虑外倾推力、回正力矩和滚动阻力。</p>
<h3>悬架 · K&amp;C 集总参数</h3>
<p>轮心等效弹簧（含缓冲块与复原限位）、压缩 / 复原分开的双斜率减振器、横向稳定杆；运动学含侧倾中心高度、抗点头 / 抗下蹲率、外倾随行程变化、轮跳转向；弹性运动学以侧向力柔度转向表示。</p>
<h3>动力总成与传动</h3>
<p>发动机外特性查表 + 倒拖扭矩 + 怠速控制 + 断油；液力变矩器按容量系数与变矩比准静态求解；闭锁后发动机惯量折算到驱动轮。自动变速器按油门插值的升 / 降档转速换挡，换挡时动力中断。开式 / 粘性限滑差速器，AWD 为固定扭矩分配。</p>
<h3>制动与主动安全</h3>
<p>主缸压力一阶建压；ABS 基于滑移率门限的减压 / 保压 / 增压循环，后轴低选、前轴横摆力矩延迟（GMA）；ESC 以线性两自由度模型的参考横摆角速度为目标对单轮制动并降扭；TCS 按驱动轮滑转率降低节气门。</p>
<h3>驾驶员模型</h3>
<p>转向：单点预瞄（纯跟踪）+ 不足转向补偿 + 横摆角速度反馈，含神经肌肉滞后与转速限制；车速：PI 控制，前馈由动力总成与制动模型反算油门 / 踏板开度。</p>

<h2><span class="eyebrow">Procedures</span>试验工况</h2>
<table class="doc"><tr><th>工况</th><th>参考标准</th><th>说明</th></tr>
${PROCEDURES.map((p) => `<tr><td>${p.name}</td><td>${p.standard}</td><td>${p.description}</td></tr>`).join('')}
</table>

<h2><span class="eyebrow">Channels</span>输出通道</h2>
<div class="chan-groups">
${groups.map((g) => `<div><h4>${g}</h4><ul>${CHANNELS.filter((c) => c.group === g && !c.hidden).map((c) => `<li><code>${c.key}</code>${c.label} <span class="dim">${c.unit}</span></li>`).join('')}</ul></div>`).join('')}
</div>

<h2><span class="eyebrow">Limits</span>适用范围与局限</h2>
<ul>
<li>车身姿态采用小角度假设，侧倾 / 俯仰超过约 20° 时结果只作定性参考；不模拟真正的侧翻过程。</li>
<li>悬架为集总参数模型，不含多体连杆几何、衬套非线性和转向系统动力学（方向盘转角直接作输入）。</li>
<li>路面为高度场 + 附着系数场，坡道只以起伏形式出现在平顺性路面里。</li>
<li>内置车型是典型量级的示例数据，不对应某款具体车型；用于工程评价时请换成实测数据。</li>
</ul>
<div class="help-foot">VDLab · Yucheng Li · 全部计算在本地浏览器完成，无需服务器</div>`;
  return h('div', { class: 'view help-wrap' }, el);
}
