# BlazeMind

A Minecraft: Java Edition launcher with an AI built in, by **[VividP1xels](https://www.youtube.com/@VividP1xels)**.

Tell the AI what you want, in the launcher or in the game, and it does it. Most things happen while you play, with no restart.

## The Mind (AI)

- **Use any AI:** Claude, ChatGPT, Gemini, **Ollama** (free, runs on your own PC, works with no internet), or any OpenAI-compatible server. Add your key in **Settings → AI**. Keys are stored encrypted on your computer.
- **In the game:** type `/ai <message>` (or `/blaze <message>`) in chat. The AI can:
  - run any command with full power in singleplayer (give, summon, effect, fill, setblock, time, weather, game rules, teleport…)
  - build structures where you stand
  - add **data packs** to your world and load them instantly (recipes, loot, custom enchantments, functions)
  - make **resource packs** and paint textures, then reload them in the running game
  - read your game log and explain crashes
- **In the launcher:** the Mind panel can make instances, search and install mods, resource packs, shaders and data packs, install whole modpacks, change mod configs, start the game and run commands on servers you host.
- New Java mods only load after a restart (that's how Minecraft works). The AI installs them and tells you.

The in-game part is the **BlazeMind Bridge** mod (Fabric and Quilt). BlazeMind adds it to your instance automatically when you press Play. It's built for Minecraft 1.20.1, 1.20.4, 1.20.6, 1.21, 1.21.1, 1.21.3, 1.21.4, 1.21.5 and 1.21.8.

## Everything else

- **Library:** instances for Vanilla, Fabric, Quilt, Forge and NeoForge, each with its own mods and worlds.
- **Add content:** search Modrinth for mods, resource packs, shaders and data packs that fit the instance. Required mods come too.
- **Discover:** install Modrinth modpacks as new instances, or import a `.mrpack` / CurseForge `.zip`.
- **Create:** a modpack builder (pick a version, loader and mods), plus AI makers for data packs, resource packs, builds, custom items and world control.
- **Offline:** after you've signed in once, BlazeMind works without internet. Play instances you've played before, make packs, and use Ollama as your AI.

## Downloads

Every build makes:
- **Windows:** `BlazeMind-Setup.exe` or `BlazeMind-Portable.exe`
- **Mac** (Intel and Apple Silicon): `BlazeMind-Mac.dmg`. The app isn't signed with a paid Apple certificate, so the first time, right-click BlazeMind and choose **Open**.
- **Linux:** `BlazeMind-Linux.AppImage` or `BlazeMind-Linux.deb`

Latest: https://github.com/VividP1xels/blazemind/releases/latest

You need a Microsoft account that owns Minecraft: Java Edition.

## Run it from source

You need [Node.js 18+](https://nodejs.org).

```bash
npm install
```

```bash
npm start
```

The Bridge mod is in `bridge-mod/` and is built by GitHub Actions for each Minecraft version (`gradle build -Pminecraft_version=1.21.1 …`). Put the built jars in `bridge/` to use them when running from source.

Inspired by [P1xel Lab](https://github.com/VividP1xels/p1xel-lab).
