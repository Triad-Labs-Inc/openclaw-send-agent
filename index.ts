import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { constants } from "node:fs";

const execFileAsync = promisify(execFile);

export default {
  id: "send-agent",
  name: "Send Agent via Email",
  description: "Zips an agent folder and sends it via Gmail using gogcli",
  register(api: OpenClawPluginApi) {
    api.registerTool({
      name: "send_agent",
      description:
        "Zip an agent folder and email it to a recipient via Gmail. " +
        "Requires gogcli (gog) to be installed and authenticated. " +
        "The agent folder will be zipped and sent as an attachment.",
      parameters: Type.Object({
        agentName: Type.String({
          description: "Name of the agent folder inside ~/.openclaw/agents/",
        }),
        to: Type.String({
          description: "Recipient email address",
        }),
        subject: Type.Optional(
          Type.String({
            description:
              "Email subject line. Defaults to 'Agent: <folder-name>'",
          })
        ),
        body: Type.Optional(
          Type.String({
            description:
              "Email body text. Defaults to a short description of the attached agent.",
          })
        ),
        account: Type.Optional(
          Type.String({
            description:
              "GOG account email or alias to send from. " +
              "If omitted, uses the default gog account.",
          })
        ),
      }),
      async execute(_id, params) {
        const agentName = params.agentName;
        const agentsDir = join(homedir(), ".openclaw", "agents");
        const agentPath = join(agentsDir, agentName);
        const folderName = agentName;
        const subject = params.subject ?? `Agent: ${folderName}`;
        const body =
          params.body ??
          `Attached is the agent "${folderName}" packaged as a zip file.`;

        // Validate the agent folder exists inside ~/.openclaw/agents/
        try {
          await access(agentPath, constants.R_OK);
        } catch {
          return {
            content: [
              {
                type: "text",
                text: `Error: Agent "${agentName}" not found in ${agentsDir}. Check available agents with: ls ~/.openclaw/agents/`,
              },
            ],
            isError: true,
          };
        }

        // Verify gog is available
        try {
          await execFileAsync("gog", ["--version"]);
        } catch {
          return {
            content: [
              {
                type: "text",
                text: "Error: gogcli (gog) is not installed or not in PATH. Install with: brew install gogcli",
              },
            ],
            isError: true,
          };
        }

        // Create a temp directory for the zip
        const tmpDir = await mkdtemp(join(tmpdir(), "openclaw-send-agent-"));
        const zipPath = join(tmpDir, `${folderName}.zip`);

        try {
          // Zip the agent folder
          try {
            await execFileAsync("zip", ["-r", zipPath, "."], {
              cwd: agentPath,
              timeout: 60_000,
            });
          } catch (zipErr: unknown) {
            const msg =
              zipErr instanceof Error ? zipErr.message : String(zipErr);
            return {
              content: [
                {
                  type: "text",
                  text: `Error zipping agent folder: ${msg}`,
                },
              ],
              isError: true,
            };
          }

          // Build gog command arguments
          const gogArgs: string[] = [];

          if (params.account) {
            gogArgs.push("--account", params.account);
          }

          gogArgs.push(
            "gmail",
            "send",
            "--to",
            params.to,
            "--subject",
            subject,
            "--body",
            body,
            "--attach",
            zipPath,
            "--json"
          );

          // Send via gogcli
          const { stdout, stderr } = await execFileAsync("gog", gogArgs, {
            timeout: 120_000,
          });

          let messageId = "unknown";
          let threadId = "unknown";
          try {
            const result = JSON.parse(stdout);
            messageId = result.messageId ?? "unknown";
            threadId = result.threadId ?? "unknown";
          } catch {
            // If JSON parsing fails, still report success if gog didn't error
          }

          return {
            content: [
              {
                type: "text",
                text: [
                  `Agent "${folderName}" sent successfully to ${params.to}.`,
                  `Message ID: ${messageId}`,
                  `Thread ID: ${threadId}`,
                ].join("\n"),
              },
            ],
          };
        } catch (sendErr: unknown) {
          const msg =
            sendErr instanceof Error ? sendErr.message : String(sendErr);
          return {
            content: [
              {
                type: "text",
                text: `Error sending email via gogcli: ${msg}`,
              },
            ],
            isError: true,
          };
        } finally {
          // Always clean up temp files
          await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
      },
    });

    api.registerService({
      id: "send-agent",
      start: () => {
        api.logger.info("send-agent: registered");
      },
    });
  },
};
