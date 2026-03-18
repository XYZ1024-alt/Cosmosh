import classNames from 'classnames';
import React from 'react';

type EntityIconProps = {
  icon: React.ReactNode;
  imageUrl?: string;
  selected?: boolean;
  tone?: 'flat' | 'filled';
};

const EntityIcon: React.FC<EntityIconProps> = ({ icon, imageUrl, tone = 'flat' }) => {
  return (
    <span
      className={classNames(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-sm-2',
        tone === 'filled' && 'bg-gray-100',
      )}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        icon
      )}
    </span>
  );
};

export default EntityIcon;
