using RAGENativeUI;
using RAGENativeUI.Elements;
using Rage;
using LSPD_First_Response.Mod.API;

namespace STPCuffExtension
{
    /// <summary>
    /// Thin RAGENativeUI wrapper that shows cuff / lean options for a specific ped.
    /// </summary>
    internal class ExtensionMenu
    {
        private readonly MenuPool    _pool;
        private readonly UIMenu      _menu;
        private readonly UIMenuItem  _itemFrontCuffs;
        private readonly UIMenuItem  _itemRearCuffs;
        private readonly UIMenuItem  _itemLean;

        private readonly CuffManager _cuffManager;
        private readonly LeanManager _leanManager;

        private Ped _target;

        public bool IsOpen => _menu.Visible;

        public ExtensionMenu(CuffManager cuffManager, LeanManager leanManager)
        {
            _cuffManager = cuffManager;
            _leanManager = leanManager;

            _pool = new MenuPool();
            _menu = new UIMenu("Suspect Options", "~b~Choose an action");
            _pool.Add(_menu);

            _itemFrontCuffs = new UIMenuItem("Handcuff (Hands Front)",
                "Apply handcuffs with the suspect's hands in front.");
            _itemRearCuffs  = new UIMenuItem("Handcuff (Hands Behind)",
                "Apply handcuffs with the suspect's hands behind their back.");
            _itemLean       = new UIMenuItem("Lean Against Vehicle",
                "Order the suspect to lean against the nearest vehicle.");

            _menu.AddItem(_itemFrontCuffs);
            _menu.AddItem(_itemRearCuffs);
            _menu.AddItem(_itemLean);

            _menu.OnItemSelect += OnItemSelect;
            _menu.OnMenuClose  += _ => _target = null;
        }

        public void Open(Ped suspect)
        {
            if (suspect == null || !suspect.Exists()) return;
            _target = suspect;

            // Show current state in the item badges / descriptions.
            var loc = _cuffManager.GetLocation(suspect);
            _itemFrontCuffs.SetRightBadge(loc == CuffManager.CuffLocation.Front
                ? UIMenuItem.BadgeStyle.Tick : UIMenuItem.BadgeStyle.None);
            _itemRearCuffs.SetRightBadge(loc == CuffManager.CuffLocation.Rear
                ? UIMenuItem.BadgeStyle.Tick : UIMenuItem.BadgeStyle.None);
            _itemLean.SetRightBadge(_leanManager.IsLeaning(suspect)
                ? UIMenuItem.BadgeStyle.Tick : UIMenuItem.BadgeStyle.None);

            _menu.Visible = true;
        }

        /// <summary>Call every tick from the main GameFiber.</summary>
        public void Process() => _pool.ProcessMenus();

        private void OnItemSelect(UIMenu sender, UIMenuItem item, int index)
        {
            if (_target == null || !_target.Exists())
            {
                _menu.Visible = false;
                return;
            }

            _menu.Visible = false;

            if (item == _itemFrontCuffs)
            {
                _leanManager.Release(_target);
                GameFiber.StartNew(() =>
                {
                    _cuffManager.SetFrontCuffs(_target);
                    Game.DisplayNotification("~b~[STPCuffExtension]~w~ Front cuffs applied.");
                }, "STPCuffExtension_FrontCuffs");
            }
            else if (item == _itemRearCuffs)
            {
                _leanManager.Release(_target);
                GameFiber.StartNew(() =>
                {
                    _cuffManager.SetRearCuffs(_target);
                    Game.DisplayNotification("~b~[STPCuffExtension]~w~ Rear cuffs applied.");
                }, "STPCuffExtension_RearCuffs");
            }
            else if (item == _itemLean)
            {
                bool found = _leanManager.LeanAgainstVehicle(_target);
                if (!found)
                    Game.DisplayNotification("~r~[STPCuffExtension]~w~ No vehicle found nearby.");
                else
                    Game.DisplayNotification("~b~[STPCuffExtension]~w~ Ordering suspect to lean against vehicle.");
            }
        }
    }
}
