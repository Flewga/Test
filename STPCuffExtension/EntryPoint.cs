using System.Windows.Forms;
using LSPD_First_Response.Mod.API;
using Rage;

[assembly: Rage.Attributes.Plugin(
    "STPCuffExtension",
    Description = "Adds front/rear handcuff switching and lean-against-vehicle to Stop The Ped",
    Author      = "")]

namespace STPCuffExtension
{
    public class EntryPoint : Plugin
    {
        private static bool         _running;
        private static CuffManager  _cuffManager;
        private static LeanManager  _leanManager;
        private static ExtensionMenu _menu;

        public override void Initialize()
        {
            Settings.Load();
            _cuffManager = new CuffManager();
            _leanManager = new LeanManager();
            _menu        = new ExtensionMenu(_cuffManager, _leanManager);

            Functions.OnOnDutyStateChanged += OnDutyStateChanged;
            Game.LogTrivial("[STPCuffExtension] Plugin initialised. Press " +
                            Settings.MenuKey + " near an arrested ped to open options.");
        }

        public override void Finally()
        {
            _running = false;
            _cuffManager?.ReleaseAll();
            _leanManager?.ReleaseAll();
            Game.LogTrivial("[STPCuffExtension] Plugin unloaded.");
        }

        private static void OnDutyStateChanged(bool onDuty)
        {
            if (onDuty && !_running)
            {
                _running = true;
                GameFiber.StartNew(MainLoop, "STPCuffExtension_Main");
            }
            else if (!onDuty)
            {
                _running = false;
                _cuffManager.ReleaseAll();
                _leanManager.ReleaseAll();
            }
        }

        private static void MainLoop()
        {
            while (_running)
            {
                GameFiber.Yield();

                _menu.Process();
                _cuffManager.Process();
                _leanManager.Process();

                if (_menu.IsOpen) continue;

                if (IsMenuKeyPressed())
                {
                    var suspect = GetNearestArrestedPed();
                    if (suspect != null)
                        _menu.Open(suspect);
                }
            }
        }

        private static bool IsMenuKeyPressed()
        {
            bool modifier = Settings.MenuModifierKey == Keys.None
                || Game.IsKeyDown(Settings.MenuModifierKey);
            return modifier && Game.IsKeyDown(Settings.MenuKey);
        }

        /// <summary>
        /// Returns the nearest ped that LSPDFR considers arrested, within the
        /// configured activation radius.
        /// </summary>
        private static Ped GetNearestArrestedPed()
        {
            var player      = Game.LocalPlayer.Character;
            float maxDist   = Settings.MenuActivationRadius;
            float closest   = float.MaxValue;
            Ped   result    = null;

            foreach (var ped in World.GetAllPeds())
            {
                if (!ped.Exists() || ped == player) continue;
                if (!Functions.IsPedArrested(ped))  continue;

                float dist = Vector3.Distance(player.Position, ped.Position);
                if (dist < maxDist && dist < closest)
                {
                    closest = dist;
                    result  = ped;
                }
            }

            return result;
        }
    }
}
