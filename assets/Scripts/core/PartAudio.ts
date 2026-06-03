// core/PartAudio.ts
//（第 8 點）每個物件的「音效介面」。把這個組件掛到任何零件 prefab 上，
// 在編輯器拖入各種情境的音效，其它系統（Health、WheelAbility、武器…）會在對應時機呼叫。
//
// 用法：node.getComponent("PartAudio")?.playHit();
// 音量沿用 cc.audioEngine 的全域 effects 音量（由 SettingManager 設定）。

const { ccclass, property } = cc._decorator;

@ccclass
export default class PartAudio extends cc.Component {
    @property({ type: cc.AudioClip, tooltip: "生成時" })
    spawnSfx: cc.AudioClip | null = null;
    @property({ type: cc.AudioClip, tooltip: "受擊時" })
    hitSfx: cc.AudioClip | null = null;
    @property({ type: cc.AudioClip, tooltip: "被摧毀時" })
    dieSfx: cc.AudioClip | null = null;
    @property({ type: cc.AudioClip, tooltip: "攻擊/開火時" })
    attackSfx: cc.AudioClip | null = null;
    @property({ type: cc.AudioClip, tooltip: "特殊能力觸發時（噴射、彈跳…）" })
    abilitySfx: cc.AudioClip | null = null;

    @property({ tooltip: "同一種音效的最短間隔秒數，避免連續觸發時太吵" })
    minInterval: number = 0.05;

    private lastPlay: { [k: string]: number } = {};

    private play(clip: cc.AudioClip | null, key: string) {
        if (!clip) return;
        const now = cc.director.getTotalTime() / 1000;
        if (this.lastPlay[key] && now - this.lastPlay[key] < this.minInterval) return;
        this.lastPlay[key] = now;
        cc.audioEngine.playEffect(clip, false);
    }

    playSpawn() { this.play(this.spawnSfx, "spawn"); }
    playHit() { this.play(this.hitSfx, "hit"); }
    playDie() { this.play(this.dieSfx, "die"); }
    playAttack() { this.play(this.attackSfx, "attack"); }
    playAbility() { this.play(this.abilitySfx, "ability"); }
}
