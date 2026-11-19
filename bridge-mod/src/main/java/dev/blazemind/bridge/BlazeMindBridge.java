package dev.blazemind.bridge;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandManager;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.registry.Registries;
import net.minecraft.resource.ResourcePackManager;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.command.CommandOutput;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.text.Text;
import net.minecraft.util.WorldSavePath;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * BlazeMind Bridge: connects Minecraft to the BlazeMind launcher's AI.
 * Type /ai <message> (or /blaze <message>) in game. The launcher runs the AI and sends back
 * commands to run, chat messages and resource pack reloads, all without restarting.
 */
public class BlazeMindBridge implements ClientModInitializer {
    private static final Gson GSON = new Gson();
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private static volatile int port = 0;
    private static volatile String token = null;

    @Override
    public void onInitializeClient() {
        ClientCommandRegistrationCallback.EVENT.register((dispatcher, access) -> {
            for (String name : new String[]{"ai", "blaze"}) {
                dispatcher.register(ClientCommandManager.literal(name)
                        .then(ClientCommandManager.argument("message", StringArgumentType.greedyString())
                                .executes(ctx -> {
                                    ask(StringArgumentType.getString(ctx, "message"));
                                    return 1;
                                })));
            }
        });
        Thread t = new Thread(BlazeMindBridge::pollLoop, "BlazeMind Bridge");
        t.setDaemon(true);
        t.start();
    }

    private static boolean readConfig() {
        try {
            Path f = FabricLoader.getInstance().getGameDir().resolve("blazemind-bridge.json");
            JsonObject o = JsonParser.parseString(Files.readString(f)).getAsJsonObject();
            port = o.get("port").getAsInt();
            token = o.get("token").getAsString();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static String post(String path, JsonObject body, int timeoutSec) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(timeoutSec))
                .header("Content-Type", "application/json")
                .header("X-Bridge-Token", token)
                .POST(HttpRequest.BodyPublishers.ofString(GSON.toJson(body)))
                .build();
        HttpResponse<String> r = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() != 200) throw new Exception("HTTP " + r.statusCode());
        return r.body();
    }

    private static void ask(String message) {
        say("§7You: §f" + message);
        CompletableFuture.runAsync(() -> {
            try {
                if (token == null && !readConfig()) throw new Exception("no launcher");
                JsonObject b = new JsonObject();
                b.addProperty("text", message);
                b.add("status", status());
                post("/ask", b, 10);
            } catch (Exception e) {
                say("§cCan't reach BlazeMind. Keep the BlazeMind launcher open while you play.");
            }
        });
    }

    private static void pollLoop() {
        while (true) {
            try {
                if (token == null && !readConfig()) { Thread.sleep(3000); continue; }
                JsonObject b = new JsonObject();
                b.add("status", status());
                String res = post("/poll", b, 30);
                JsonArray jobs = JsonParser.parseString(res).getAsJsonObject().getAsJsonArray("jobs");
                if (jobs != null) for (JsonElement je : jobs) handle(je.getAsJsonObject());
            } catch (Exception e) {
                token = null;
                try { Thread.sleep(2000); } catch (InterruptedException ignored) { return; }
            }
        }
    }

    private static void handle(JsonObject job) {
        String type = job.has("type") ? job.get("type").getAsString() : "";
        String id = job.has("id") ? job.get("id").getAsString() : "";
        MinecraftClient c = MinecraftClient.getInstance();
        switch (type) {
            case "say" -> say("§6§l[BlazeMind]§r " + job.get("text").getAsString());
            case "commands" -> {
                List<String> cmds = new ArrayList<>();
                for (JsonElement e : job.getAsJsonArray("commands")) cmds.add(e.getAsString());
                JsonArray results = runCommands(cmds);
                reply(id, results);
            }
            case "reload_resources" -> {
                try { c.submit(() -> c.reloadResources()).get(60, TimeUnit.SECONDS); } catch (Exception ignored) { }
                reply(id, new JsonArray());
            }
            case "enable_pack" -> {
                String pack = job.get("pack").getAsString();
                try {
                    c.submit(() -> {
                        ResourcePackManager rpm = c.getResourcePackManager();
                        rpm.scanPacks();
                        if (!c.options.resourcePacks.contains(pack)) c.options.resourcePacks.add(pack);
                        c.options.refreshResourcePacks(rpm);
                        c.options.write();
                    }).get(120, TimeUnit.SECONDS);
                } catch (Exception ignored) { }
                reply(id, new JsonArray());
            }
            default -> { }
        }
    }

    private static void reply(String id, JsonArray results) {
        try {
            JsonObject b = new JsonObject();
            b.addProperty("id", id);
            b.add("results", results);
            post("/result", b, 10);
        } catch (Exception ignored) { }
    }

    private static JsonArray runCommands(List<String> cmds) {
        MinecraftClient c = MinecraftClient.getInstance();
        MinecraftServer server = c.getServer();
        JsonArray out = new JsonArray();
        if (c.player == null) {
            JsonObject r = new JsonObject();
            r.addProperty("error", "The player isn't in a world yet.");
            out.add(r);
            return out;
        }
        if (server != null) {
            // Singleplayer: run on the built-in server with full operator power and collect the output
            UUID uuid = c.player.getUuid();
            try {
                return server.submit(() -> {
                    JsonArray arr = new JsonArray();
                    ServerPlayerEntity p = server.getPlayerManager().getPlayer(uuid);
                    for (String cmd : cmds) {
                        List<String> lines = new ArrayList<>();
                        CommandOutput o = new CommandOutput() {
                            @Override public void sendMessage(Text message) { lines.add(message.getString()); }
                            @Override public boolean shouldReceiveFeedback() { return true; }
                            @Override public boolean shouldTrackOutput() { return true; }
                            @Override public boolean shouldBroadcastConsoleToOps() { return false; }
                        };
                        JsonObject r = new JsonObject();
                        r.addProperty("command", cmd);
                        try {
                            ServerCommandSource src = p != null
                                    ? new ServerCommandSource(o, p.getPos(), p.getRotationClient(), (ServerWorld) p.getWorld(), 4,
                                        p.getName().getString(), p.getDisplayName(), server, p)
                                    : server.getCommandSource();
                            server.getCommandManager().executeWithPrefix(src, cmd.startsWith("/") ? cmd.substring(1) : cmd);
                            r.addProperty("output", String.join("\n", lines));
                        } catch (Exception e) {
                            r.addProperty("error", String.valueOf(e.getMessage()));
                        }
                        arr.add(r);
                    }
                    return arr;
                }).get(60, TimeUnit.SECONDS);
            } catch (Exception e) {
                JsonObject r = new JsonObject();
                r.addProperty("error", "Running commands failed: " + e.getMessage());
                out.add(r);
                return out;
            }
        }
        // Multiplayer: send the commands as the player (the server decides what's allowed)
        for (String cmd : cmds) {
            String clean = cmd.startsWith("/") ? cmd.substring(1) : cmd;
            try { c.submit(() -> c.player.networkHandler.sendChatCommand(clean)).get(5, TimeUnit.SECONDS); } catch (Exception ignored) { }
            JsonObject r = new JsonObject();
            r.addProperty("command", cmd);
            r.addProperty("output", "Sent to the server. Its answer shows in chat; you need op for most commands.");
            out.add(r);
        }
        return out;
    }

    private static JsonObject status() {
        JsonObject s = new JsonObject();
        MinecraftClient c = MinecraftClient.getInstance();
        try {
            return c.submit(() -> {
                JsonObject o = new JsonObject();
                o.addProperty("inWorld", c.player != null && c.world != null);
                if (c.player == null || c.world == null) return o;
                MinecraftServer server = c.getServer();
                o.addProperty("singleplayer", server != null);
                o.addProperty("player", c.player.getName().getString());
                o.addProperty("x", Math.floor(c.player.getX()));
                o.addProperty("y", Math.floor(c.player.getY()));
                o.addProperty("z", Math.floor(c.player.getZ()));
                o.addProperty("facing", c.player.getHorizontalFacing().asString());
                o.addProperty("dimension", c.world.getRegistryKey().getValue().toString());
                if (c.interactionManager != null) o.addProperty("gameMode", c.interactionManager.getCurrentGameMode().name().toLowerCase());
                o.addProperty("health", c.player.getHealth());
                o.addProperty("heldItem", Registries.ITEM.getId(c.player.getMainHandStack().getItem()).toString());
                o.addProperty("timeOfDay", c.world.getTimeOfDay() % 24000);
                if (server != null) o.addProperty("worldDir", server.getSavePath(WorldSavePath.ROOT).toAbsolutePath().normalize().toString());
                else if (c.getCurrentServerEntry() != null) o.addProperty("server", c.getCurrentServerEntry().address);
                return o;
            }).get(3, TimeUnit.SECONDS);
        } catch (Exception e) {
            s.addProperty("inWorld", false);
            return s;
        }
    }

    private static void say(String text) {
        MinecraftClient c = MinecraftClient.getInstance();
        c.execute(() -> {
            if (c.inGameHud != null && c.player != null) c.inGameHud.getChatHud().addMessage(Text.literal(text));
        });
    }
}
