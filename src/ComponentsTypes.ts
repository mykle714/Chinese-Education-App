// Settings related interfaces

export interface SettingsListItemProps {
  type: string;
  name: string;
  description: string;
  labels?: string[];
}

export interface ToggleSwitchProps {
  name: string
}

export interface RadioGroupProps {
  groupName: string;
  buttonLabels: string[];
}

// Learn related interfaces

export interface ActivityCardProps {
  title: string;
  description: string;
  buttonText: string;
  activityLink: string;
  imagePath: string;
}