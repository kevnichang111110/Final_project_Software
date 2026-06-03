// weapons/MouseCannon.ts
//（第 2、7 點）滑鼠瞄準砲。把這個組件掛在武器 prefab 上，該武器就會：
//   - 由玩家滑鼠控制（按住左鍵朝游標方向直線射擊）
//   - 子彈會「無差別」傷害，不管打到己方還是對方的方塊都會扣血
//
// 實際的滑鼠追蹤與開火由 BattleManager 統一處理（它每幀知道游標世界座標）。
// 這個組件本身只負責「標記 + 提供參數」，方便不同砲有不同數值。
//
// 建議在這個 prefab 底下放一個名為 "firepoint" 的子節點當砲口，子彈會從那裡發射。

import { MOUSE_BULLET, MOUSE_TURRET } from "../core/GameConstants";

const { ccclass, property } = cc._decorator;

@ccclass
export default class MouseCannon extends cc.Component {
    @property({ tooltip: "開火間隔（秒）" })
    fireInterval: number = MOUSE_BULLET.FIRE_INTERVAL;

    @property({ tooltip: "可旋轉半角（度）。總可轉範圍是 2 倍：90 = 左右各 90（共 180）；想略小於 180 就填小一點" })
    aimHalfArc: number = MOUSE_TURRET.HALF_ARC;

    @property({ tooltip: "子彈速度" })
    bulletSpeed: number = MOUSE_BULLET.SPEED;

    @property({ tooltip: "子彈傷害" })
    bulletDamage: number = MOUSE_BULLET.DAMAGE;

    @property({ tooltip: "子彈存活秒數" })
    bulletLifetime: number = MOUSE_BULLET.LIFETIME;

    @property({ tooltip: "按住滑鼠是否連射" })
    autoFireWhileHeld: boolean = true;
}