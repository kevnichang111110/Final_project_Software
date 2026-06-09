// battle/StuckRescue.ts
// 卡住自救：偵測車子「想動卻動不了」一段時間後，自動找最近一個可以站的位置，
// 把整台車（保持零件相對排列）平移＋扶正過去，避免卡在突起 / 牆角翻不回來。
//
// 由 BattleManager 在建好車後 new 一個，並每幀呼叫 update(dt, isTrying, avoidPos)。
//   - isTrying：玩家有按移動鍵 / Bot 正在驅動時才算「想動」，避免玩家停著也被瞬移。
//   - avoidPos：對手車的位置（世界座標），避免救援時瞬移到對手身上。

import { GROUP, RESCUE } from "../core/GameConstants";
import { BuiltCar } from "./CarBuilder";

export default class StuckRescue {
    private root: cc.Node;
    private partGroup: string;
    private coreNode: cc.Node | null;

    private lastPos: cc.Vec2 | null = null;
    private noProgress = 0;   // 累積「沒前進」的時間
    private cooldown = 0;     // 救援後的冷卻

    constructor(car: BuiltCar, root: cc.Node, partGroup: string) {
        this.root = root;
        this.partGroup = partGroup;
        this.coreNode = car.coreNode;
    }

    update(dt: number, isTrying: boolean, avoidPos?: cc.Vec2 | null) {
        if (this.cooldown > 0) this.cooldown -= dt;

        const core = this.coreNode;
        if (!core || !core.isValid) return;
        const here = core.convertToWorldSpaceAR(cc.v2(0, 0));

        if (!this.lastPos) { this.lastPos = here; this.noProgress = 0; return; }

        // 有明顯位移 → 視為有在動，歸零計時
        const moved = Math.hypot(here.x - this.lastPos.x, here.y - this.lastPos.y);
        if (moved > RESCUE.MIN_PROGRESS) {
            this.lastPos = here;
            this.noProgress = 0;
            return;
        }

        // 沒前進，而且正在嘗試移動 → 累積卡住時間
        if (isTrying) this.noProgress += dt;
        else this.noProgress = 0;   // 沒在嘗試（玩家放手）就不算卡住

        if (this.noProgress >= RESCUE.STUCK_TIME && this.cooldown <= 0) {
            const target = this.findStandable(here, avoidPos);
            if (target) {
                this.relocate(target);
                this.cooldown = RESCUE.COOLDOWN;
            }
            // 不論成功與否都重置計時，避免每幀狂試
            this.noProgress = 0;
            this.lastPos = core.convertToWorldSpaceAR(cc.v2(0, 0));
        }
    }

    // 車上仍屬於本車的零件剛體（已脫落的碎片 group 變 default，會被排除）
    private livingBodies(): cc.RigidBody[] {
        const out: cc.RigidBody[] = [];
        if (!this.root || !this.root.isValid) return out;
        this.root.getComponentsInChildren(cc.RigidBody).forEach(rb => {
            if (rb.node && rb.node.isValid && rb.node.group === this.partGroup) out.push(rb);
        });
        return out;
    }

    // 估算車體半徑（核心到最遠零件）：拿來當抬升高度 / 搜尋間距 / 淨空
    private carRadius(coreWorld: cc.Vec2): number {
        let r = 40;
        for (const rb of this.livingBodies()) {
            const w = rb.node.convertToWorldSpaceAR(cc.v2(0, 0));
            const d = Math.hypot(w.x - coreWorld.x, w.y - coreWorld.y);
            if (d > r) r = d;
        }
        return r;
    }

    // 從目前位置往外一圈圈找「腳下有地、頭上沒牆、不在對手身上」的站位，回傳核心要去的世界座標
    private findStandable(fromWorld: cc.Vec2, avoidPos?: cc.Vec2 | null): cc.Vec2 | null {
        const pm = cc.director.getPhysicsManager();
        const cr = this.carRadius(fromWorld);
        const lift = cr + RESCUE.CLEARANCE;
        const step = Math.max(RESCUE.SEARCH_STEP, cr * 1.2);

        for (let ring = 1; ring <= RESCUE.SEARCH_RINGS; ring++) {
            const radius = ring * step;
            for (let a = 0; a < RESCUE.SEARCH_SAMPLES; a++) {
                const ang = (a / RESCUE.SEARCH_SAMPLES) * Math.PI * 2;
                const cx = fromWorld.x + Math.cos(ang) * radius;
                const cy = fromWorld.y + Math.sin(ang) * radius;

                // 往下打射線找最高的地面（group default / boundary）
                const top = cc.v2(cx, cy + RESCUE.UP_PROBE);
                const bottom = cc.v2(cx, cy - RESCUE.DOWN_PROBE);
                const hits = pm.rayCast(top, bottom, cc.RayCastType.All);
                let floorY: number | null = null;
                for (const h of hits) {
                    const g = h.collider.node.group;
                    if (g !== GROUP.DEFAULT && g !== GROUP.BOUNDARY) continue;
                    if (floorY === null || h.point.y > floorY) floorY = h.point.y;
                }
                if (floorY === null) continue;

                const standY = floorY + lift;

                // 頭上要有淨空（別塞進牆裡/天花板）：往上短射線不該馬上撞到邊界
                const up = pm.rayCast(cc.v2(cx, standY), cc.v2(cx, standY + cr + RESCUE.CLEARANCE), cc.RayCastType.Closest);
                let blocked = false;
                for (const h of up) {
                    const g = h.collider.node.group;
                    if (g === GROUP.DEFAULT || g === GROUP.BOUNDARY) { blocked = true; break; }
                }
                if (blocked) continue;

                // 別瞬移到對手身上
                if (avoidPos && Math.hypot(cx - avoidPos.x, standY - avoidPos.y) < cr * 2) continue;

                return cc.v2(cx, standY);
            }
        }
        return null;
    }

    // 把整台車當「剛體」搬移：對每個零件套用同一個 (旋轉到水平 + 位移到目標) 的剛體變換。
    // 因為是整體同一個剛體運動，所有零件的相對位置不變 → 關節不會被拉爆。
    private relocate(targetCoreWorld: cc.Vec2) {
        const core = this.coreNode;
        if (!core || !core.isValid) return;

        const coreWorld = core.convertToWorldSpaceAR(cc.v2(0, 0));
        const dAngle = -core.angle;                    // 扶正到水平（度）
        const rad = dAngle * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);

        for (const rb of this.livingBodies()) {
            const nd = rb.node;
            const w = nd.convertToWorldSpaceAR(cc.v2(0, 0));
            const dx = w.x - coreWorld.x, dy = w.y - coreWorld.y;
            const rx = dx * cos - dy * sin;
            const ry = dx * sin + dy * cos;
            const newWorld = cc.v2(targetCoreWorld.x + rx, targetCoreWorld.y + ry);

            const parent = nd.parent || this.root;
            nd.setPosition(parent.convertToNodeSpaceAR(newWorld));
            nd.angle += dAngle;

            rb.linearVelocity = cc.v2(0, 0);
            rb.angularVelocity = 0;
            // 把節點 transform 推進物理世界（Cocos 2.x：型別定義缺，故 as any）
            const anyRb = rb as any;
            if (anyRb.syncPosition) anyRb.syncPosition(false);
            if (anyRb.syncRotation) anyRb.syncRotation(false);
            rb.awake = true;
        }
    }
}
