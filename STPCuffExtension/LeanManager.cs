using System.Collections.Generic;
using System.Linq;
using Rage;
using Rage.Native;

namespace STPCuffExtension
{
    /// <summary>
    /// Positions a stopped/arrested ped against the side of the nearest vehicle
    /// and keeps them there via a looping scenario.
    /// </summary>
    internal class LeanManager
    {
        private readonly HashSet<Ped> _leaning = new HashSet<Ped>();

        // Maximum distance to search for a vehicle to lean against.
        private const float VehicleSearchRadius = 8f;

        // How close (metres) the ped must be to the lean position before we
        // start the scenario — avoids playing it while they're still walking.
        private const float ArrivalThreshold = 1.2f;

        // ------------------------------------------------------------------ //
        //  Public API                                                          //
        // ------------------------------------------------------------------ //

        /// <summary>
        /// Starts a GameFiber that walks the ped to the nearest vehicle and
        /// plays the leaning scenario.  Returns false if no vehicle is found.
        /// </summary>
        public bool LeanAgainstVehicle(Ped ped)
        {
            if (!ped.Exists()) return false;

            var vehicle = World.GetClosestVehicle(ped.Position, VehicleSearchRadius);
            if (vehicle == null || !vehicle.Exists()) return false;

            _leaning.Add(ped);
            GameFiber.StartNew(() => RunLean(ped, vehicle), "STPCuffExtension_Lean");
            return true;
        }

        public bool IsLeaning(Ped ped) => _leaning.Contains(ped);

        public void Release(Ped ped)
        {
            if (!_leaning.Contains(ped)) return;
            _leaning.Remove(ped);
            if (ped.Exists())
            {
                NativeFunction.CallByName<uint>("CLEAR_PED_TASKS", ped);
                NativeFunction.CallByName<uint>("CLEAR_PED_SECONDARY_TASK", ped);
            }
        }

        public void ReleaseAll()
        {
            foreach (var ped in _leaning.ToList())
                Release(ped);
        }

        /// <summary>Called from the main loop — cleans up peds that have left.</summary>
        public void Process()
        {
            foreach (var ped in _leaning.ToList())
            {
                if (!ped.Exists() || ped.IsDead)
                    _leaning.Remove(ped);
            }
        }

        // ------------------------------------------------------------------ //
        //  Internals                                                           //
        // ------------------------------------------------------------------ //

        private void RunLean(Ped ped, Vehicle vehicle)
        {
            if (!ped.Exists() || !vehicle.Exists())
            {
                _leaning.Remove(ped);
                return;
            }

            // ----- Pre-process: walk the ped to the vehicle side -----
            var leanPos    = GetLeanPosition(ped, vehicle);
            float leanHeading = GetLeanHeading(vehicle, leanPos);

            // Clear current tasks so the ped is free to walk.
            NativeFunction.CallByName<uint>("CLEAR_PED_TASKS", ped);
            GameFiber.Sleep(100);

            // Task the ped to walk to the lean position.
            NativeFunction.CallByName<uint>("TASK_GO_TO_COORD_ANY_MEANS",
                ped,
                leanPos.X, leanPos.Y, leanPos.Z,
                1.0f,   // walk speed
                0,      // timeout (0 = none)
                false,
                786603, // steering flags
                0.0f);

            // Wait until arrived or timeout (6 seconds).
            int timeout = 120;
            while (_leaning.Contains(ped) && ped.Exists() && vehicle.Exists())
            {
                float dist = Vector3.Distance(ped.Position, leanPos);
                if (dist <= ArrivalThreshold) break;
                if (--timeout <= 0)
                {
                    Game.LogTrivial("[STPCuffExtension] LeanVehicle: Timed out walking to vehicle.");
                    break;
                }
                GameFiber.Sleep(50);
            }

            if (!_leaning.Contains(ped) || !ped.Exists()) return;

            // ----- Process: face away from vehicle and play scenario -----
            NativeFunction.CallByName<uint>("CLEAR_PED_TASKS", ped);
            GameFiber.Sleep(150);

            // Snap the ped to the exact lean spot and heading.
            NativeFunction.CallByName<uint>("SET_ENTITY_COORDS_NO_OFFSET",
                ped, leanPos.X, leanPos.Y, leanPos.Z, false, false, false);
            NativeFunction.CallByName<uint>("SET_ENTITY_HEADING", ped, leanHeading);
            GameFiber.Sleep(100);

            // Start the lean scenario in-place.
            NativeFunction.CallByName<uint>("TASK_START_SCENARIO_IN_PLACE",
                ped, Settings.LeanScenario, 0, true);

            Game.LogTrivial($"[STPCuffExtension] LeanVehicle: {ped.Handle} is leaning against {vehicle.Handle}.");
        }

        /// <summary>Returns the position on the nearest side of the vehicle.</summary>
        private static Vector3 GetLeanPosition(Ped ped, Vehicle vehicle)
        {
            // Project the ped's position onto the vehicle's right axis to find
            // which side they're on, then offset outward by ~0.9 m.
            Vector3 toSuspect = ped.Position - vehicle.Position;
            float   dot       = Vector3.Dot(toSuspect, vehicle.RightVector);

            Vector3 side     = dot >= 0 ? vehicle.RightVector : -vehicle.RightVector;
            float   halfWidth = vehicle.Model.Dimensions.X / 2f + 0.9f;

            Vector3 pos = vehicle.Position + side * halfWidth;
            pos.Z       = vehicle.Position.Z;
            return pos;
        }

        /// <summary>Returns the heading the ped should face (away from the vehicle).</summary>
        private static float GetLeanHeading(Vehicle vehicle, Vector3 leanPos)
        {
            // Face outward (away from the vehicle centre).
            Vector3 outward = leanPos - vehicle.Position;
            outward.Z = 0f;
            if (outward == Vector3.Zero) outward = vehicle.RightVector;

            return MathHelper.ConvertDirectionToHeading(outward.ToNormalized());
        }
    }
}
