import GameManager from "./GameManager";
const { ccclass, property } = cc._decorator;

@ccclass
export default class SettingsManager extends cc.Component {

    @property(cc.Slider)
    bgmSlider: cc.Slider = null;

    @property(cc.Slider)
    sfxSlider: cc.Slider = null;

    onLoad() {
        this.bgmSlider.progress = GameManager.bgmVolume;
        this.sfxSlider.progress = GameManager.sfxVolume;

        cc.audioEngine.setMusicVolume(GameManager.bgmVolume);
        cc.audioEngine.setEffectsVolume(GameManager.sfxVolume);

        if (cc.director.getPhysicsManager()) {
            cc.director.getPhysicsManager().enabled = false;
        }
    }

    // 當 BGM Slider 滑動時
    onBgmSlide() {
        let vol = this.bgmSlider.progress;
        cc.audioEngine.setMusicVolume(vol);
        GameManager.bgmVolume = vol;
        cc.sys.localStorage.setItem("bgm_vol", vol.toString());
    }

    // 當 SFX Slider 滑動時
    onSfxSlide() {
        let vol = this.sfxSlider.progress;
        cc.audioEngine.setEffectsVolume(vol);
        GameManager.sfxVolume = vol;
        cc.sys.localStorage.setItem("sfx_vol", vol.toString());
    }
    

    onResume() {
        cc.director.getPhysicsManager().enabled = true;
        this.node.destroy();
    }

    onQuit() {
        cc.director.getPhysicsManager().enabled = true;
        cc.director.loadScene("Menu");
    }
}