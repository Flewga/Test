using System.Collections.Generic;
using System.Linq;
using Rage;
using Rage.Native;

namespace STPCuffExtension
{
    /// <summary>
    /// Tracks which peds have had their cuff position overridden and maintains
    /// the chosen animation and prop against any LSPDFR resets.
    /// </summary>
    internal class CuffManager
    {
        public enum CuffLocation { Rear, Front }

        // Maps each controlled ped to its current cuff location and attached prop.
        private readonly Dictionary<Ped, (CuffLocation Location, Object Prop)> _cuffed =
            new Dictionary<Ped, (CuffLocation, Object)>();

        // Bone indices for standard GTA V peds.
        private const int BoneRightHand = 57005; // SKEL_R_Hand
        private const int BoneLeftHand  = 18905; // SKEL_L_Hand

        // Animation flags.
        private const int AnimFlagLoop      = 1;
        private const int AnimFlagUpperBody = 16;
        private const int AnimFlagPhysics   = 128;

        // ------------------------------------------------------------------ //
        //  Public API                                                          //
        // ------------------------------------------------------------------ //

        public void SetFrontCuffs(Ped ped)
        {
            if (!ped.Exists()) return;
            CleanupPed(ped);

            bool loaded = LoadAnimDict(Settings.FrontCuffAnimDict);
            if (loaded)
            {
                NativeFunction.CallByName<uint>("TASK_PLAY_ANIM",
                    ped,
                    Settings.FrontCuffAnimDict,
                    Settings.FrontCuffAnimName,
                    8.0f,                      // blend in
                    -8.0f,                     // blend out
                    -1,                        // duration: loop
                    AnimFlagLoop | AnimFlagPhysics,
                    0.0f,
                    false, false, false);
            }

            var prop = AttachCuffProp(ped, CuffLocation.Front);
            _cuffed[ped] = (CuffLocation.Front, prop);
        }

        public void SetRearCuffs(Ped ped)
        {
            if (!ped.Exists()) return;
            CleanupPed(ped);

            bool loaded = LoadAnimDict(Settings.RearCuffAnimDict);
            if (loaded)
            {
                NativeFunction.CallByName<uint>("TASK_PLAY_ANIM",
                    ped,
                    Settings.RearCuffAnimDict,
                    Settings.RearCuffAnimName,
                    8.0f, -8.0f, -1,
                    AnimFlagLoop | AnimFlagPhysics,
                    0.0f,
                    false, false, false);
            }

            var prop = AttachCuffProp(ped, CuffLocation.Rear);
            _cuffed[ped] = (CuffLocation.Rear, prop);
        }

        /// <summary>Call from your main GameFiber loop to keep animations alive.</summary>
        public void Process()
        {
            foreach (var key in _cuffed.Keys.ToList())
            {
                var (location, prop) = _cuffed[key];

                if (!key.Exists() || key.IsDead)
                {
                    CleanupPed(key);
                    continue;
                }

                // Re-apply if LSPDFR cleared our animation.
                if (!IsPlayingOurAnim(key, location))
                {
                    switch (location)
                    {
                        case CuffLocation.Front: SetFrontCuffs(key); break;
                        case CuffLocation.Rear:  SetRearCuffs(key);  break;
                    }
                }
            }
        }

        public bool IsTracking(Ped ped) => _cuffed.ContainsKey(ped);

        public CuffLocation? GetLocation(Ped ped) =>
            _cuffed.TryGetValue(ped, out var entry) ? entry.Location : (CuffLocation?)null;

        public void Release(Ped ped) => CleanupPed(ped);

        public void ReleaseAll()
        {
            foreach (var ped in _cuffed.Keys.ToList())
                CleanupPed(ped);
        }

        // ------------------------------------------------------------------ //
        //  Internals                                                           //
        // ------------------------------------------------------------------ //

        private bool IsPlayingOurAnim(Ped ped, CuffLocation location)
        {
            string dict = location == CuffLocation.Front
                ? Settings.FrontCuffAnimDict
                : Settings.RearCuffAnimDict;
            string clip = location == CuffLocation.Front
                ? Settings.FrontCuffAnimName
                : Settings.RearCuffAnimName;

            return NativeFunction.CallByName<bool>(
                "IS_ENTITY_PLAYING_ANIM", ped, dict, clip, 3);
        }

        private static bool LoadAnimDict(string dict)
        {
            NativeFunction.CallByName<uint>("REQUEST_ANIM_DICT", dict);
            int attempts = 0;
            while (!NativeFunction.CallByName<bool>("HAS_ANIM_DICT_LOADED", dict))
            {
                GameFiber.Sleep(50);
                if (++attempts > 60) // 3 seconds
                {
                    Game.LogTrivial("[STPCuffExtension] Timed out loading anim dict: " + dict);
                    return false;
                }
            }
            return true;
        }

        private static Object AttachCuffProp(Ped ped, CuffLocation location)
        {
            bool isMale = !ped.IsFemale;
            string modelName = location == CuffLocation.Front
                ? (isMale ? Settings.MaleFrontCuffModel : Settings.FemaleFrontCuffModel)
                : (isMale ? Settings.MaleRearCuffModel  : Settings.FemaleRearCuffModel);

            var model = new Model(modelName);
            model.LoadAndWait();

            if (!model.IsValid || !model.IsLoaded)
            {
                Game.LogTrivial("[STPCuffExtension] Cuff prop model not valid: " + modelName);
                return null;
            }

            var prop = new Object(model, ped.Position, false);
            if (!prop.Exists()) return null;

            if (location == CuffLocation.Front)
            {
                // Front cuffs: attach centred between both hands on the right wrist,
                // slightly forward so prop sits in front of the torso.
                NativeFunction.CallByName<uint>("ATTACH_ENTITY_TO_ENTITY",
                    prop, ped, BoneRightHand,
                    0.04f, 0.01f, 0.0f,       // offset
                    0.0f,  0.0f, -90.0f,       // rotation
                    false, false, false, false, 2, true);
            }
            else
            {
                // Rear cuffs: behind the back on the right wrist.
                NativeFunction.CallByName<uint>("ATTACH_ENTITY_TO_ENTITY",
                    prop, ped, BoneRightHand,
                    0.0f, -0.08f, 0.04f,
                    0.0f,  0.0f, -90.0f,
                    false, false, false, false, 2, true);
            }

            return prop;
        }

        private void CleanupPed(Ped ped)
        {
            if (_cuffed.TryGetValue(ped, out var entry))
            {
                if (entry.Prop != null && entry.Prop.Exists())
                    entry.Prop.Delete();
                _cuffed.Remove(ped);
            }
        }
    }
}
