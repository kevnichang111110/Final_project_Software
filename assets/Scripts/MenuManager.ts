import GameManager from "./GameManager";
const { ccclass, property } = cc._decorator;

@ccclass
export default class MenuManager extends cc.Component {

    // 如果你有做 Setting 的 Prefab，可以拖到這裡，但我們先做基本跳轉
    @property(cc.Prefab)
    settingsPrefab: cc.Prefab|null = null;

    @property(cc.AudioClip)
    bgmClip: cc.AudioClip |null= null;

    private bgmAudioID: number = -1;
    onLoad() {
        
        cc.audioEngine.setMusicVolume(GameManager.bgmVolume);
        cc.audioEngine.setEffectsVolume(GameManager.sfxVolume);
        if (this.bgmClip) {
            this.bgmAudioID = cc.audioEngine.playMusic(this.bgmClip, true);
        }
    }


    onPlayButtonClick() {
        cc.director.loadScene("SelectMode");
    }

    onLeaderboardButtonClick() {
        cc.director.loadScene("Leaderboard");
    }
    Singleplayer() {
        GameManager.resetAllData();
        cc.director.loadScene("Shop");
    }
    Multiplayer() {
        GameManager.resetAllData();
        cc.director.loadScene("Shop");
    }
    onOpenSettings() {
        if (this.settingsPrefab) {
            let settingsNode = cc.instantiate(this.settingsPrefab);
            let canvas = cc.find("Canvas");
            settingsNode.parent = canvas;
            settingsNode.setSiblingIndex(canvas.childrenCount - 1);
            settingsNode.setPosition(0, 0);
        } else {
            console.error("尚未在編輯器中關聯 Settings Prefab！");
        }
    }
    

}