// Load only the five reviewed JS managers. The optional native overlay addon is
// never imported or shipped. Calls cross FFI into the Valve-signed Steam DLL.
const root = 'steamworks-ffi-node/dist/internal/';
const { SteamLibraryLoader } = require(root + 'SteamLibraryLoader');
const { SteamAPICore } = require(root + 'SteamAPICore');
function createSDK() {
  const loader = new SteamLibraryLoader(), core = new SteamAPICore(loader);
  const sdk = {
    init: options => core.init(options), setSdkPath: value => core.setSdkPath(value),
    getStatus: () => core.getStatus(), runCallbacks: () => core.runCallbacks(),
    shutdown() { this.networkingSockets.closeAll(); this.matchmaking.cleanup(); core.shutdown(); }
  };
  for (const [property, name] of Object.entries({ friends: 'SteamFriendsManager', matchmaking: 'SteamMatchmakingManager', networkingUtils: 'SteamNetworkingUtilsManager', networkingSockets: 'SteamNetworkingSocketsManager' })) {
    sdk[property] = new (require(root + name)[name])(loader, core);
  }
  return sdk;
}
module.exports = { createSDK };
