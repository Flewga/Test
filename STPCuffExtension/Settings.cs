using System.IO;
using System.Windows.Forms;
using Rage;

namespace STPCuffExtension
{
    internal static class Settings
    {
        private const string IniPath = @"plugins/LSPDFR/STPCuffExtension.ini";

        // Keys
        public static Keys MenuKey             { get; private set; } = Keys.H;
        public static Keys MenuModifierKey     { get; private set; } = Keys.None;

        // Front-cuffs animation (hands in front, wrists together)
        public static string FrontCuffAnimDict { get; private set; } = "mp_arresting";
        public static string FrontCuffAnimName { get; private set; } = "a_uncuff";

        // Rear-cuffs animation (hands behind back)
        public static string RearCuffAnimDict  { get; private set; } = "random@arrests";
        public static string RearCuffAnimName  { get; private set; } = "kneeling_arrest_idle";

        // Cuff prop models (male / female)
        public static string MaleFrontCuffModel  { get; private set; } = "prop_cs_cuffs_01";
        public static string FemaleFrontCuffModel { get; private set; } = "prop_cs_cuffs_01";
        public static string MaleRearCuffModel   { get; private set; } = "p_cs_cuffs_02_s";
        public static string FemaleRearCuffModel { get; private set; } = "p_cs_cuffs_02_s";

        // Lean-against-vehicle scenario
        public static string LeanScenario      { get; private set; } = "WORLD_HUMAN_LEANING";

        // How close a ped must be (metres) for the menu to target them
        public static float MenuActivationRadius { get; private set; } = 5f;

        public static void Load()
        {
            if (!File.Exists(IniPath))
            {
                WriteDefaults();
                return;
            }

            var ini = new InitializationFile(IniPath);

            MenuKey           = ini.ReadEnum("Keys", "MenuKey",           Keys.H);
            MenuModifierKey   = ini.ReadEnum("Keys", "MenuModifierKey",   Keys.None);

            FrontCuffAnimDict = ini.ReadString("CuffAnimation", "FrontCuffAnimDict", FrontCuffAnimDict);
            FrontCuffAnimName = ini.ReadString("CuffAnimation", "FrontCuffAnimName", FrontCuffAnimName);
            RearCuffAnimDict  = ini.ReadString("CuffAnimation", "RearCuffAnimDict",  RearCuffAnimDict);
            RearCuffAnimName  = ini.ReadString("CuffAnimation", "RearCuffAnimName",  RearCuffAnimName);

            MaleFrontCuffModel   = ini.ReadString("Props", "MaleFrontCuffModel",   MaleFrontCuffModel);
            FemaleFrontCuffModel = ini.ReadString("Props", "FemaleFrontCuffModel", FemaleFrontCuffModel);
            MaleRearCuffModel    = ini.ReadString("Props", "MaleRearCuffModel",    MaleRearCuffModel);
            FemaleRearCuffModel  = ini.ReadString("Props", "FemaleRearCuffModel",  FemaleRearCuffModel);

            LeanScenario          = ini.ReadString("Lean", "LeanScenario",          LeanScenario);
            MenuActivationRadius  = ini.ReadSingle("General", "MenuActivationRadius", MenuActivationRadius);

            Game.LogTrivial("[STPCuffExtension] Settings loaded.");
        }

        private static void WriteDefaults()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(IniPath));
            File.WriteAllText(IniPath,
@"// STPCuffExtension - Companion plugin for Stop The Ped
// Reference for valid Keys: https://msdn.microsoft.com/en-us/library/system.windows.forms.keys(v=vs.110).aspx

[Keys]
// Press this key near an arrested ped to open the cuff/lean menu
MenuKey=H
MenuModifierKey=None

[CuffAnimation]
// Animation played when switching to front cuffs
FrontCuffAnimDict=mp_arresting
FrontCuffAnimName=a_uncuff
// Animation played when switching to rear cuffs
RearCuffAnimDict=random@arrests
RearCuffAnimName=kneeling_arrest_idle

[Props]
// Handcuff prop models attached to the ped (change to ba_prop_battle_cuffs for battle cuffs)
MaleFrontCuffModel=prop_cs_cuffs_01
FemaleFrontCuffModel=prop_cs_cuffs_01
MaleRearCuffModel=p_cs_cuffs_02_s
FemaleRearCuffModel=p_cs_cuffs_02_s

[Lean]
// GTA V scenario used for leaning against vehicle
LeanScenario=WORLD_HUMAN_LEANING

[General]
// Radius in metres within which the menu can target an arrested ped
MenuActivationRadius=5
");
            Game.LogTrivial("[STPCuffExtension] Default settings file written to " + IniPath);
        }
    }
}
