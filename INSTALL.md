# Install on iPad

This repository is the MOZU code: the Next.js website plus the MozuScanner iPad app.
Every change is a commit. Open **Commits** on GitHub to see exactly what changed.

You need:
- A Mac with Xcode, installed from the App Store and opened once.
- An iPad with LiDAR (iPad Pro 2020 or later, or iPad Air 2022 or later).
- A USB-C cable.
- An Apple ID.

## 1. Get the code and open it (one command)

Paste this into Terminal. Run the same command again any time to pull the latest changes.

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer && \
( command -v brew >/dev/null || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" ) && \
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)" && \
brew install xcodegen && \
( [ -d ~/Scan_Room/.git ] || git clone https://github.com/cosmosmining/Scan_Room.git ~/Scan_Room ) && \
cd ~/Scan_Room && git pull && \
cd apps/ios && xcodegen generate && open MozuScanner.xcodeproj
```

## 2. Install on the iPad

1. Plug in the iPad, unlock it, and tap **Trust**.
2. In Xcode, select the **MozuScanner** target. Under **Signing & Capabilities**, set **Team** to your Apple ID.
3. At the top of Xcode, choose **your iPad by name**, not "Any iOS Device". Then press **⌘R**.
4. On the iPad, go to **Settings → Privacy & Security → Developer Mode**, turn it on and restart. Then press **⌘R** again.
5. Free Apple ID only: on the iPad, go to **Settings → General → VPN & Device Management** and tap **Trust** for your developer certificate.

With a free Apple ID the app stops opening after 7 days. To reinstall, plug in the iPad and press **⌘R**.

## 3. Website (optional, to send scans to the browser)

```bash
cd ~/Scan_Room && npm install && npm run build && npm start
# in a second Terminal window:
brew install cloudflared && cloudflared tunnel --url http://localhost:3000
```

The tunnel prints an `https://….trycloudflare.com` address. In the app, on the Floorplan screen, type that address into **MOZU web address**.

Node 18.18 or newer is required. If you don't have it, run `brew install node`.

## If something goes wrong

| What you see | Fix |
| --- | --- |
| "A build only device cannot be used to run this target" | At the top of Xcode, pick your iPad by name. |
| The iPad is not in the device list | Unlock it and tap Trust. Turn on Developer Mode. Open **Window → Devices and Simulators** and wait for the iPad to appear. |
| The iPad shows as "unavailable" or "not supported" | Update Xcode from the App Store. |
| "Failed to register bundle identifier" | In `apps/ios/project.yml`, change `com.mozu.scanner` to `com.YOURNAME.scanner`. Run `xcodegen generate` and press ⌘R. |
| "Untrusted Developer" on the iPad | Settings → General → VPN & Device Management → Trust. |
| `git pull` says your local changes would be overwritten | Run `git stash`, then run the command again. Your changes are saved; `git stash pop` brings them back. |

More detail: `START-HERE.md`.
