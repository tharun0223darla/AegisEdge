import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/userrole.enum';
import { MedicationSafetyController } from './medication-safety.controller';

describe('MedicationSafetyController active-mode authorization', () => {
  it('is patient-only at the controller boundary', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, MedicationSafetyController) as
      | UserRole[]
      | undefined;

    expect(roles).toEqual([UserRole.PATIENT]);
  });
});
