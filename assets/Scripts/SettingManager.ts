const { ccclass, property } = cc._decorator;

@ccclass
export default class SettingsManager extends cc.Component {

    @property(cc.Slider)
    bgmSlider: cc.Slider = null;

    @property(cc.Slider)
    sfxSlider: cc.Slider = null;

    onLoad() {
        // 1. 初始化 Slider 的位置 (讀取目前的音量)
        this.bgmSlider.progress = cc.audioEngine.getMusicVolume();
        this.sfxSlider.progress = cc.audioEngine.getEffectsVolume();

        // 2. 暫停物理引擎 (如果是在遊戲中彈出)
        cc.director.getPhysicsManager().enabled = false;
    }

    // 當 BGM Slider 滑動時
    onBgmSlide() {
        cc.audioEngine.setMusicVolume(this.bgmSlider.progress);
    }

    // 當 SFX Slider 滑動時
    onSfxSlide() {
        cc.audioEngine.setEffectsVolume(this.sfxSlider.progress);
    }

    // Resume 按鈕：關閉設定並恢復物理
    onResume() {
        cc.director.getPhysicsManager().enabled = true;
        this.node.destroy(); // 關閉設定視窗 (銷毀節點)
    }

    // QUIT 按鈕：回到主選單
    onQuit() {
        // 切換場景前確保物理恢復，避免下個場景出錯
        cc.director.getPhysicsManager().enabled = true;
        cc.director.loadScene("Menu");
    }
}