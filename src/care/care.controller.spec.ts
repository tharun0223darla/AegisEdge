import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/userrole.enum';
import { CareController } from './care.controller';

function handlerRoles(name: keyof CareController): UserRole[] | undefined {
  return Reflect.getMetadata(ROLES_KEY, CareController.prototype[name]) as
    | UserRole[]
    | undefined;
}

describe('CareController active-mode authorization', () => {
  it.each([
    'requestDoseHelp',
    'createInvitation',
    'listInvitations',
    'revokeInvitation',
    'updatePermissions',
    'revokeRelationship',
    'getAccessLog',
  ] as Array<keyof CareController>)('%s is patient-only', (handler) => {
    expect(handlerRoles(handler)).toEqual([UserRole.PATIENT]);
  });

  it.each([
    'previewInvitation',
    'acceptInvitation',
    'listAsCaregiver',
    'getCaregiverDashboard',
  ] as Array<keyof CareController>)('%s is caregiver-only', (handler) => {
    expect(handlerRoles(handler)).toEqual([UserRole.CAREGIVER]);
  });
});
