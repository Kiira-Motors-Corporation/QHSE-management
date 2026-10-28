import type { IconName } from "../components/Icon";
import type { Role } from "./session";

/**
 * The navigation and route table for the whole system.
 *
 * This is the single declaration of who may open what. The rail renders from
 * it, the route guards read it, and the redirect after sign-in derives from
 * it. Two lists would eventually disagree, and the one that disagreed silently
 * would be the one governing access.
 *
 * The structure follows the prototype the client approved: the Health and
 * Wellness division and its three units. Quality Inspection and Environment
 * and Sustainability were removed when the client established that those
 * divisions already run their own systems.
 *
 * Items are hidden entirely, never disabled, when a role has no access. A
 * disabled control tells someone there is something they are not allowed to
 * do, which invites a conversation about being allowed to do it.
 */
export interface NavItem {
  path: string;
  label: string;
  /** Must be registered in components/Icon.tsx. */
  icon: IconName;
  /** Roles that may open the route. */
  roles: Role[];
  /** Roles that see the route without any entry, approval or edit control. */
  readOnlyFor?: Role[];
  /** Short description used on page headers and module scaffolds. */
  summary?: string;
  /** Routes reachable from this item but not shown in the rail. */
  children?: NavItem[];
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

const officer: Role = "hwms-officer";
const manager: Role = "hwms-manager";
const director: Role = "hwms-director";

/**
 * Clinical routes. Individual clinical records are open to the Health and
 * Wellness Officer alone, not the manager, not the director, not an
 * administrator. This is the rule the whole access design exists to protect,
 * and it is enforced again at the service layer and proved by test.
 */
const clinical: Role[] = [officer];

/** Operational routes: the officer enters, the manager reviews. */
const operational: Role[] = [officer, manager];

export const navigation: NavGroup[] = [
  {
    label: null,
    items: [
      {
        path: "/dashboard",
        label: "Dashboard",
        icon: "dashboard",
        roles: [officer, manager, director],
        summary:
          "Occupational health and safety performance for the reporting month and the year to date, with the provenance of every figure.",
      },
    ],
  },
  {
    label: "Occupational health",
    items: [
      {
        path: "/patients",
        label: "Patients",
        icon: "clinical_notes",
        roles: clinical,
        summary:
          "The registry of everyone eligible to attend. Open a patient to see their whole history in one place. Employee number is optional, so nobody is turned away for want of an identifier.",
        children: [
          { path: "/patients/new", label: "Register patient", icon: "clinical_notes", roles: clinical },
          { path: "/patients/record", label: "Patient record", icon: "clinical_notes", roles: clinical },
        ],
      },
      {
        path: "/patient-visits",
        label: "Patient visits",
        icon: "assignment",
        roles: clinical,
        summary:
          "Clinic attendances, section by section, following the order of the paper form. Signing locks the record; correction is by appended amendment.",
        children: [
          { path: "/patient-visits/new", label: "Record visit", icon: "assignment", roles: clinical },
          { path: "/patient-visits/details", label: "Visit detail", icon: "assignment", roles: clinical },
        ],
      },
      {
        path: "/laboratory",
        label: "Laboratory",
        icon: "science",
        roles: clinical,
        summary:
          "Requisitions on KMC.DQHSE.05/26-FM008, raised from a visit. Results are recorded as the laboratory reported them; the form defines no reference ranges, so nothing is flagged abnormal.",
        children: [
          { path: "/laboratory/new", label: "New request", icon: "science", roles: clinical },
          { path: "/laboratory/details", label: "Request detail", icon: "science", roles: clinical },
        ],
      },
      {
        path: "/referrals",
        label: "Referrals",
        icon: "forward_to_inbox",
        roles: clinical,
        summary:
          "Referral to an external facility on form KMC.DQHSE.02/26-FM004, through its lifecycle from drafted to reviewed, downloadable as a PDF.",
        children: [
          { path: "/referrals/new", label: "New referral", icon: "forward_to_inbox", roles: clinical },
          { path: "/referrals/details", label: "Referral detail", icon: "forward_to_inbox", roles: clinical },
        ],
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        path: "/industrial-hygiene",
        label: "Industrial hygiene",
        icon: "monitor_heart",
        roles: operational,
        readOnlyFor: [manager],
        summary:
          "Occupational exposure and indoor workplace readings, evaluated against the standard in force on the date of the reading.",
      },
      {
        path: "/ergonomics-wellness",
        label: "Ergonomics and wellness",
        icon: "accessibility_new",
        roles: operational,
        readOnlyFor: [manager],
        summary:
          "Workstation assessments with a compliant, partially compliant or non-compliant outcome, and the corrective actions raised from them.",
      },
      {
        path: "/monthly-returns",
        label: "Monthly returns",
        icon: "calendar_month",
        roles: operational,
        readOnlyFor: [manager],
        summary:
          "Figures sourced outside this system, entered once a month with their source, entering user and date recorded against them.",
      },
    ],
  },
];

/** Every route in the table, including those not shown in the rail. */
export const allRoutes: NavItem[] = navigation.flatMap((group) =>
  group.items.flatMap((item) => [item, ...(item.children ?? [])]),
);

export function routeFor(path: string): NavItem | undefined {
  return allRoutes.find((item) => item.path === path);
}

export function canOpen(item: NavItem, role: Role | null): boolean {
  return role !== null && item.roles.includes(role);
}

export function isReadOnly(item: NavItem, role: Role | null): boolean {
  return role !== null && (item.readOnlyFor ?? []).includes(role);
}

/** Groups filtered to what this role may open, children excluded from the rail. */
export function navigationFor(role: Role | null): NavGroup[] {
  if (!role) return [];
  return navigation
    .map((group) => ({
      label: group.label,
      items: group.items.filter((item) => canOpen(item, role)),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * Where a role lands after signing in.
 *
 * The officer lands on the work rather than the dashboard, per UI-01. Someone
 * who opens this system to record a patient visit should not have to navigate
 * past a performance summary to reach it.
 */
export function homePathFor(role: Role | null): string {
  switch (role) {
    case "hwms-officer":
      return "/patient-visits";
    case "hwms-manager":
    case "hwms-director":
      return "/dashboard";
    default:
      return "/login";
  }
}
