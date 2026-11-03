import { useEffect, useRef } from 'react';
import { Form, useNavigation } from 'react-router';
import type {
  SellerApplicationActionData,
  SellerApplicationDraft,
  SellerApplicationField,
} from '../seller-application.types';

interface Choice {
  value: string;
  label: string;
}

function DraftField({
  name,
  label,
  value,
  error,
  choices,
  multiline = false,
}: {
  name: SellerApplicationField;
  label: string;
  value: string;
  error?: string;
  choices?: Choice[];
  multiline?: boolean;
}) {
  const errorId = `${name}-error`;
  const describedBy = error ? errorId : undefined;

  return (
    <div className='seller-draft__field'>
      <label htmlFor={name}>{label}</label>

      {choices ? (
        <select
          id={name}
          name={name}
          defaultValue={value}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        >
          <option value=''>Choose an option</option>
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      ) : multiline ? (
        <textarea
          id={name}
          name={name}
          defaultValue={value}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          rows={4}
        />
      ) : (
        <input
          id={name}
          name={name}
          type='text'
          defaultValue={value}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        />
      )}

      {error && (
        <p id={errorId} className='seller-draft__field-error'>
          {error}
        </p>
      )}
    </div>
  );
}

export function SellerApplicationDraftForm({
  application,
  csrfToken,
  actionData,
}: {
  application: SellerApplicationDraft | null;
  csrfToken: string;
  actionData?: SellerApplicationActionData;
}) {
  const navigation = useNavigation();
  const summaryRef = useRef<HTMLDivElement>(null);
  const pending = navigation.state === 'submitting';
  const errors = actionData?.fieldErrors ?? {};
  const hasErrors = Boolean(
    actionData?.formError || Object.keys(errors).length,
  );
  const submittedValues = actionData?.values;

  useEffect(() => {
    if (hasErrors) summaryRef.current?.focus();
  }, [actionData, hasErrors]);

  function value(field: SellerApplicationField): string {
    if (submittedValues) return submittedValues[field];

    const stored = application?.[field];
    return typeof stored === 'string' ? stored : '';
  }

  return (
    <main className='seller-draft'>
      <h1>Seller application draft</h1>
      <p>
        You can save an incomplete draft. Submission and document uploads are
        not available yet.
      </p>

      {actionData?.success && <p role='status'>Your draft has been saved.</p>}

      {hasErrors && (
        <div
          ref={summaryRef}
          className='seller-draft__errors'
          role='alert'
          aria-labelledby='seller-draft-error-title'
          tabIndex={-1}
        >
          <h2 id='seller-draft-error-title'>There is a problem</h2>
          {actionData?.formError && <p>{actionData.formError}</p>}
          {Object.entries(errors).map(([field, message]) => (
            <p key={field}>
              <a href={`#${field}`}>{message}</a>
            </p>
          ))}
        </div>
      )}

      <Form method='post' noValidate>
        <input type='hidden' name='_csrfToken' value={csrfToken} />

        <DraftField
          name='sellerType'
          label='Seller type'
          value={value('sellerType')}
          error={errors.sellerType}
          choices={[
            { value: 'individual', label: 'Individual' },
            { value: 'commercial', label: 'Commercial' },
          ]}
        />

        <DraftField
          name='applicantRelationship'
          label='Your relationship to the business'
          value={value('applicantRelationship')}
          error={errors.applicantRelationship}
          choices={[
            { value: 'owner', label: 'Owner' },
            {
              value: 'authorized_representative',
              label: 'Authorized representative',
            },
          ]}
        />

        <DraftField
          name='proposedStoreName'
          label='Proposed store name'
          value={value('proposedStoreName')}
          error={errors.proposedStoreName}
        />
        <DraftField
          name='privateContactPhone'
          label='Private contact phone'
          value={value('privateContactPhone')}
          error={errors.privateContactPhone}
          choices={undefined}
        />
        <DraftField
          name='city'
          label='City'
          value={value('city') || 'Yaoundé'}
          error={errors.city}
        />
        <DraftField
          name='neighborhood'
          label='Neighborhood'
          value={value('neighborhood')}
          error={errors.neighborhood}
        />
        <DraftField
          name='sellerDescription'
          label='Short seller description'
          value={value('sellerDescription')}
          error={errors.sellerDescription}
          multiline
        />
        <DraftField
          name='inventoryCondition'
          label='Inventory condition'
          value={value('inventoryCondition')}
          error={errors.inventoryCondition}
          choices={[
            { value: 'new', label: 'New' },
            { value: 'used', label: 'Used' },
            { value: 'both', label: 'Both' },
          ]}
        />
        <DraftField
          name='fulfillmentOption'
          label='Fulfillment option'
          value={value('fulfillmentOption')}
          error={errors.fulfillmentOption}
          choices={[
            { value: 'pickup', label: 'Pickup' },
            { value: 'local_delivery', label: 'Local delivery' },
            { value: 'both', label: 'Both' },
          ]}
        />

        <fieldset className='seller-draft__commercial'>
          <legend>Commercial details</legend>
          <p>Complete these fields when applying as a commercial seller.</p>

          <DraftField
            name='businessTradingName'
            label='Business or trading name'
            value={value('businessTradingName')}
            error={errors.businessTradingName}
          />
          <DraftField
            name='businessContactName'
            label='Business contact name'
            value={value('businessContactName')}
            error={errors.businessContactName}
          />
          <DraftField
            name='registrationStatus'
            label='Business registration status'
            value={value('registrationStatus')}
            error={errors.registrationStatus}
            choices={[
              { value: 'registered', label: 'Registered' },
              {
                value: 'registration_pending',
                label: 'Registration pending',
              },
              { value: 'not_registered', label: 'Not registered' },
            ]}
          />
          <DraftField
            name='registrationReference'
            label='Registration reference'
            value={value('registrationReference')}
            error={errors.registrationReference}
          />
          <DraftField
            name='privateOperatingAddress'
            label='Private operating address'
            value={value('privateOperatingAddress')}
            error={errors.privateOperatingAddress}
            multiline
          />
        </fieldset>

        <button type='submit' disabled={pending}>
          {pending ? 'Saving…' : 'Save draft'}
        </button>
      </Form>
    </main>
  );
}
